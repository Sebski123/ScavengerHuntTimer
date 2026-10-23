const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");

const app = initializeApp();
const db = getFirestore(app, "default");

const REGION = "europe-west1";
const CHALLENGE_IDS = new Set([
  "challenge1",
  "challenge2",
  "challenge3",
  "challenge4",
  "challenge5",
]);
const MAX_TEAMS = 4;

function normalizeAnswer(value) {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

function publicState(puzzle, attempt, nowMs, extra = {}) {
  if (!attempt) {
    return {
      status: "notStarted",
      title: puzzle.title,
      serverNowMs: nowMs,
      ...extra,
    };
  }

  const purchasedCount = attempt.hintsUsed || 0;
  const hints = puzzle.hints || [];

  return {
    status: attempt.finishedAt ? "finished" : "running",
    title: puzzle.title,
    clue: puzzle.clue,
    startedAtMs: attempt.startedAt.toMillis(),
    finishedAtMs: attempt.finishedAt
      ? attempt.finishedAt.toMillis()
      : null,
    penaltySeconds: attempt.penaltySeconds || 0,
    hints: hints.slice(0, purchasedCount).map((hint) => ({
      text: hint.text,
      penaltySeconds: hint.penaltySeconds,
    })),
    nextHintPenaltySeconds:
      !attempt.finishedAt && purchasedCount < hints.length
        ? hints[purchasedCount].penaltySeconds
        : null,
    serverNowMs: nowMs,
    ...extra,
  };
}

exports.game = onCall(
  {
    region: REGION,
    maxInstances: 2,
    timeoutSeconds: 30,
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Please sign in.");
    }

    const uid = request.auth.uid;
    const input = request.data || {};
    const { action, challengeId } = input;

    if (!["state", "start", "hint", "answer"].includes(action)) {
      throw new HttpsError("invalid-argument", "Unknown action.");
    }

    if (!CHALLENGE_IDS.has(challengeId)) {
      throw new HttpsError("invalid-argument", "Unknown challenge.");
    }

    if (
      action === "answer" &&
      (typeof input.answer !== "string" || input.answer.length > 200)
    ) {
      throw new HttpsError("invalid-argument", "Invalid answer.");
    }

    if (
      action === "hint" &&
      (!Number.isInteger(input.hintIndex) || input.hintIndex < 0)
    ) {
      throw new HttpsError("invalid-argument", "Invalid hint.");
    }

    const teamRef = db.doc(`teams/${uid}`);
    const puzzleRef = db.doc(`puzzles/${challengeId}`);
    const attemptRef = db.doc(`attempts/${uid}_${challengeId}`);

    return db.runTransaction(async (transaction) => {
      // Complete all reads before making any writes.
      const teamSnapshot = await transaction.get(teamRef);
      const puzzleSnapshot = await transaction.get(puzzleRef);
      const attemptSnapshot = await transaction.get(attemptRef);

      if (!teamSnapshot.exists) {
        throw new HttpsError(
          "permission-denied",
          "This account is not an authorized team."
        );
      }

      if (!puzzleSnapshot.exists) {
        throw new HttpsError("not-found", "Challenge not configured.");
      }

      const puzzle = puzzleSnapshot.data();
      let attempt = attemptSnapshot.exists
        ? attemptSnapshot.data()
        : null;

      const now = Timestamp.now();
      const nowMs = now.toMillis();

      if (action === "state") {
        return publicState(puzzle, attempt, nowMs);
      }

      if (action === "start") {
        if (!attempt) {
          attempt = {
            teamUid: uid,
            teamName: teamSnapshot.data().name,
            challengeId,
            startedAt: now,
            finishedAt: null,
            hintsUsed: 0,
            penaltySeconds: 0,
            wrongAnswers: 0,
            lastSubmissionAt: null,
          };

          transaction.create(attemptRef, attempt);
        }

        // Repeated starts return the existing attempt.
        return publicState(puzzle, attempt, nowMs);
      }

      if (!attempt) {
        throw new HttpsError(
          "failed-precondition",
          "Start this challenge first."
        );
      }

      if (attempt.finishedAt) {
        return publicState(puzzle, attempt, nowMs);
      }

      if (action === "hint") {
        const hints = puzzle.hints || [];
        const nextIndex = attempt.hintsUsed || 0;

        // Retrying an already purchased hint must not charge again.
        if (input.hintIndex < nextIndex) {
          return publicState(puzzle, attempt, nowMs);
        }

        if (input.hintIndex !== nextIndex || nextIndex >= hints.length) {
          throw new HttpsError(
            "failed-precondition",
            "That hint is not available."
          );
        }

        const penalty = hints[nextIndex].penaltySeconds;

        if (
          !Number.isInteger(penalty) ||
          penalty < 0
        ) {
          throw new HttpsError(
            "failed-precondition",
            "The hint penalty is incorrectly configured."
          );
        }

        attempt = {
          ...attempt,
          hintsUsed: nextIndex + 1,
          penaltySeconds: (attempt.penaltySeconds || 0) + penalty,
        };

        transaction.update(attemptRef, {
          hintsUsed: attempt.hintsUsed,
          penaltySeconds: attempt.penaltySeconds,
        });

        return publicState(puzzle, attempt, nowMs);
      }

      // A short submission cooldown discourages rapid guessing.
      if (
        attempt.lastSubmissionAt &&
        nowMs - attempt.lastSubmissionAt.toMillis() < 3000
      ) {
        throw new HttpsError(
          "resource-exhausted",
          "Please wait a few seconds before submitting again."
        );
      }

      const submitted = normalizeAnswer(input.answer);

      const correct = (puzzle.answers || []).some(
        (answer) => normalizeAnswer(answer) === submitted
      );

      const updates = {
        lastSubmissionAt: now,
      };

      if (correct) {
        updates.finishedAt = now;
        updates.elapsedMilliseconds =
          nowMs - attempt.startedAt.toMillis();
        updates.scoredMilliseconds =
          updates.elapsedMilliseconds +
          (attempt.penaltySeconds || 0) * 1000;
      } else {
        updates.wrongAnswers = (attempt.wrongAnswers || 0) + 1;
      }

      transaction.update(attemptRef, updates);
      attempt = { ...attempt, ...updates };

      return publicState(puzzle, attempt, nowMs, { correct });
    });
  }
);

exports.organizerOverview = onCall(
  {
    region: REGION,
    maxInstances: 2,
    timeoutSeconds: 30,
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Please sign in.");
    }

    if (
      request.data != null &&
      (typeof request.data !== "object" || Array.isArray(request.data) ||
        Object.keys(request.data).length > 0)
    ) {
      throw new HttpsError("invalid-argument", "This function accepts no input.");
    }

    const organizerSnapshot = await db.doc(`organizers/${request.auth.uid}`).get();
    if (
      !organizerSnapshot.exists ||
      organizerSnapshot.data().role !== "organizer"
    ) {
      throw new HttpsError("permission-denied", "Organizer access is required.");
    }

    const teamSnapshot = await db.collection("teams").limit(MAX_TEAMS + 1).get();
    if (teamSnapshot.size > MAX_TEAMS) {
      throw new HttpsError(
        "failed-precondition",
        `The dashboard supports at most ${MAX_TEAMS} teams.`
      );
    }

    const teams = teamSnapshot.docs.map((document) => {
      const name = document.data().name;
      if (typeof name !== "string" || !name.trim()) {
        throw new HttpsError(
          "failed-precondition",
          "Every team must have a non-empty name."
        );
      }

      return { uid: document.id, name: name.trim() };
    }).sort((left, right) => left.name.localeCompare(right.name));

    const challengeIds = [...CHALLENGE_IDS];
    const puzzleSnapshots = await Promise.all(
      challengeIds.map((challengeId) => db.doc(`puzzles/${challengeId}`).get())
    );
    const challenges = challengeIds.map((challengeId, index) => ({
      challengeId,
      title: puzzleSnapshots[index].exists
        ? puzzleSnapshots[index].data().title || challengeId
        : challengeId,
    }));

    const nowMs = Timestamp.now().toMillis();
    const attemptEntries = await Promise.all(
      teams.flatMap((team) =>
        challengeIds.map(async (challengeId) => {
          const snapshot = await db.doc(`attempts/${team.uid}_${challengeId}`).get();
          return { teamUid: team.uid, challengeId, attempt: snapshot.exists ? snapshot.data() : null };
        })
      )
    );

    const attemptByKey = new Map(
      attemptEntries.map((entry) => [
        `${entry.teamUid}_${entry.challengeId}`,
        entry.attempt,
      ])
    );

    const overviewTeams = teams.map((team) => {
      const attempts = challengeIds.map((challengeId) => {
        const attempt = attemptByKey.get(`${team.uid}_${challengeId}`);
        if (!attempt) {
          return {
            challengeId,
            status: "notStarted",
            startedAtMs: null,
            finishedAtMs: null,
            elapsedMilliseconds: null,
            scoredMilliseconds: null,
            hintsUsed: 0,
            penaltySeconds: 0,
            wrongAnswers: 0,
          };
        }

        const startedAtMs = attempt.startedAt?.toMillis?.() ?? null;
        const finishedAtMs = attempt.finishedAt?.toMillis?.() ?? null;
        const penaltySeconds = Number.isInteger(attempt.penaltySeconds) &&
          attempt.penaltySeconds >= 0 ? attempt.penaltySeconds : 0;
        const isFinished = finishedAtMs !== null;
        const elapsedMilliseconds = isFinished
          ? Number.isFinite(attempt.elapsedMilliseconds)
            ? attempt.elapsedMilliseconds
            : startedAtMs === null ? null : Math.max(0, finishedAtMs - startedAtMs)
          : startedAtMs === null ? null : Math.max(0, nowMs - startedAtMs);
        const scoredMilliseconds = isFinished && Number.isFinite(attempt.scoredMilliseconds)
          ? attempt.scoredMilliseconds
          : elapsedMilliseconds === null
            ? null
            : elapsedMilliseconds + penaltySeconds * 1000;

        return {
          challengeId,
          status: isFinished ? "finished" : "running",
          startedAtMs,
          finishedAtMs,
          elapsedMilliseconds,
          scoredMilliseconds,
          hintsUsed: Number.isInteger(attempt.hintsUsed) && attempt.hintsUsed >= 0
            ? attempt.hintsUsed
            : 0,
          penaltySeconds,
          wrongAnswers: Number.isInteger(attempt.wrongAnswers) && attempt.wrongAnswers >= 0
            ? attempt.wrongAnswers
            : 0,
        };
      });

      return {
        name: team.name,
        completedChallenges: attempts.filter((attempt) => attempt.status === "finished").length,
        attempts,
      };
    });

    return { serverNowMs: nowMs, challenges, teams: overviewTeams };
  }
);