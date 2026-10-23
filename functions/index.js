const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");

initializeApp();

const db = getFirestore();

const REGION = "europe-west1";
const CHALLENGE_IDS = new Set([
  "challenge1",
  "challenge2",
  "challenge3",
  "challenge4",
  "challenge5",
]);

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