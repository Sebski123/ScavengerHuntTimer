import {
    onAuthStateChanged,
    signInWithEmailAndPassword,
    signOut,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import { auth, callOrganizerOverview } from "./firebase-client.js";

const $ = (id) => document.getElementById(id);
const durationAnchor = { serverNowMs: 0, performanceNowMs: 0 };
let busy = false;
let activeUid = null;

function setBusy(value) {
  busy = value;
  document.querySelectorAll("button").forEach((button) => {
    button.disabled = value;
  });
}

function showMessage(message) {
  $("message").textContent = message;
}

function formatDuration(milliseconds) {
  if (!Number.isFinite(milliseconds)) return "-";

  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:` +
      String(seconds).padStart(2, "0");
  }

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatPenalty(seconds) {
  return `+${formatDuration(seconds * 1000)}`;
}

function makeCell(text, className = "") {
  const cell = document.createElement("td");
  cell.textContent = text;
  if (className) cell.className = className;
  return cell;
}

function renderOverview(overview) {
  durationAnchor.serverNowMs = overview.serverNowMs;
  durationAnchor.performanceNowMs = performance.now();
  const challengeTitles = new Map(
    overview.challenges.map((challenge) => [challenge.challengeId, challenge.title])
  );
  const rows = document.createDocumentFragment();

  for (const team of overview.teams) {
    for (const attempt of team.attempts) {
      const row = document.createElement("tr");
      const teamName = makeCell(team.name);
      teamName.setAttribute("scope", "row");
      row.append(
        teamName,
        makeCell(`${team.completedChallenges}/5`),
        makeCell(challengeTitles.get(attempt.challengeId) || attempt.challengeId)
      );

      const status = document.createElement("td");
      const statusLabel = document.createElement("span");
      statusLabel.className = `status status-${attempt.status}`;
      statusLabel.textContent = {
        notStarted: "Not started",
        running: "Running",
        finished: "Finished",
      }[attempt.status] || "Unknown";
      status.append(statusLabel);
      row.append(status);

      const elapsedCell = makeCell(formatDuration(attempt.elapsedMilliseconds));
      const penaltyCell = makeCell(formatPenalty(attempt.penaltySeconds));
      const scoredCell = makeCell(formatDuration(attempt.scoredMilliseconds));
      const hintsCell = makeCell(String(attempt.hintsUsed));
      const wrongCell = makeCell(String(attempt.wrongAnswers));

      if (attempt.status === "running" && Number.isFinite(attempt.elapsedMilliseconds)) {
        row.dataset.running = "true";
        row.dataset.elapsedMs = String(attempt.elapsedMilliseconds);
        row.dataset.penaltyMs = String(attempt.penaltySeconds * 1000);
        row.append(elapsedCell, penaltyCell, scoredCell, hintsCell, wrongCell);
      } else {
        row.append(elapsedCell, penaltyCell, scoredCell, hintsCell, wrongCell);
      }

      rows.append(row);
    }
  }

  $("overview-rows").replaceChildren(rows);
  $("team-count").textContent = overview.teams.length === 0
    ? "No teams configured"
    : `${overview.teams.length} teams · ${overview.teams.reduce(
      (total, team) => total + team.completedChallenges,
      0
    )} of ${overview.teams.length * 5} challenges finished`;
}

function updateRunningTimes() {
  const estimatedServerNow = durationAnchor.serverNowMs +
    (performance.now() - durationAnchor.performanceNowMs);
  const elapsedSinceRefresh = estimatedServerNow - durationAnchor.serverNowMs;

  for (const row of document.querySelectorAll('tr[data-running="true"]')) {
    const baseElapsed = Number(row.dataset.elapsedMs);
    const penalty = Number(row.dataset.penaltyMs);
    const cells = row.cells;
    const elapsed = baseElapsed + elapsedSinceRefresh;

    cells[4].textContent = formatDuration(elapsed);
    cells[6].textContent = formatDuration(elapsed + penalty);
  }
}

function describeError(error) {
  const code = error.code?.replace(/^functions\//, "");
  if (code === "permission-denied") {
    return "This account is not on the organizer allowlist.";
  }
  if (code === "unauthenticated") {
    return "Your session expired. Sign in again.";
  }
  if (code === "failed-precondition") {
    return error.message || "The overview is not configured correctly.";
  }
  return "Could not load the overview. Check your connection and retry.";
}

async function loadOverview() {
  if (busy || !auth.currentUser) return;

  const requestUid = auth.currentUser.uid;
  setBusy(true);
  showMessage("Refreshing overview…");

  try {
    const result = await callOrganizerOverview({});
    if (auth.currentUser?.uid !== requestUid) return;
    renderOverview(result.data);
    showMessage("");
  } catch (error) {
    console.error(error);
    if (auth.currentUser?.uid === requestUid) {
      showMessage(describeError(error));
    }
  } finally {
    setBusy(false);
  }
}

$("login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (busy) return;

  setBusy(true);
  showMessage("Signing in…");
  let signedIn = false;

  try {
    await signInWithEmailAndPassword(
      auth,
      $("email").value.trim(),
      $("password").value
    );
    $("password").value = "";
    signedIn = true;
  } catch (error) {
    console.error(error);
    showMessage("Sign-in failed. Check the organizer account and try again.");
  } finally {
    setBusy(false);
  }

  if (signedIn) await loadOverview();
});

$("refresh").addEventListener("click", loadOverview);
$("sign-out").addEventListener("click", async () => {
  if (busy) return;
  setBusy(true);
  try {
    await signOut(auth);
  } catch (error) {
    console.error(error);
    showMessage("Could not sign out. Please retry.");
  } finally {
    setBusy(false);
  }
});

onAuthStateChanged(auth, (user) => {
  const uid = user?.uid || null;
  if (uid === activeUid) return;
  activeUid = uid;

  $("login-section").hidden = Boolean(user);
  $("dashboard").hidden = !user;
  $("session-controls").hidden = !user;
  $("signed-in").textContent = user?.email || "";
  $("overview-rows").replaceChildren();
  $("team-count").textContent = "";

  if (!user) {
    showMessage("");
    return;
  }

  loadOverview();
});

setInterval(updateRunningTimes, 1000);
