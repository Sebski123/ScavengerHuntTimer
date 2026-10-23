import {
    onAuthStateChanged,
    signInWithEmailAndPassword,
    signOut,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import { auth, callGame } from "./firebase-client.js";

const $ = (id) => document.getElementById(id);

let currentState = null;
let busy = false;
let clockAnchor = null;
let answerFeedbackTimeout = null;
let activeUid = undefined;
let authStartupComplete = false;

const challengeParam = new URLSearchParams(window.location.search).get("challenge");
const challengeId = [
  "challenge1",
  "challenge2",
  "challenge3",
  "challenge4",
  "challenge5",
].includes(challengeParam) ? challengeParam : null;

function consumeTeamQrCredentials() {
  const params = new URLSearchParams(window.location.hash.slice(1));
  const isTeamQr = params.get("team-login") === "1";

  if (window.location.hash) {
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${window.location.search}`
    );
  }

  if (!isTeamQr) return { credentials: null, invalid: false };

  const email = params.get("email");
  const password = params.get("password");

  if (!email || !password || email.length > 254 || password.length > 4096) {
    return { credentials: null, invalid: true };
  }

  return { credentials: { email, password }, invalid: false };
}

const teamQr = consumeTeamQrCredentials();

function showMessage(text) {
  $("message").textContent = text;
}

function showLoginMessage(text) {
  $("login-message").textContent = text;
}

function clearAnswerFeedback() {
  if (answerFeedbackTimeout) {
    clearTimeout(answerFeedbackTimeout);
    answerFeedbackTimeout = null;
  }

  const feedback = $("answer-feedback");
  feedback.textContent = "";
  feedback.hidden = true;
}

function showAnswerFeedback(text) {
  clearAnswerFeedback();
  const feedback = $("answer-feedback");
  feedback.textContent = text;
  feedback.hidden = false;
  answerFeedbackTimeout = setTimeout(clearAnswerFeedback, 4000);
}

function setBusy(value) {
  busy = value;

  document.querySelectorAll("button").forEach((element) => {
    element.disabled = value;
  });
}

async function perform(task) {
  if (busy) return;

  setBusy(true);
  showMessage("");

  try {
    await task();
  } catch (error) {
    console.error(error);
    showMessage(error.message || "Something went wrong. Please retry.");
  } finally {
    setBusy(false);
  }
}

function formatTime(milliseconds) {
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

function updateClock() {
  if (!currentState || currentState.status === "notStarted") {
    $("timing").textContent = "";
    return;
  }

  // This display is approximate; the server owns the actual timestamps.
  const estimatedServerNow =
    clockAnchor.serverNowMs +
    (performance.now() - clockAnchor.localPerformanceMs);

  const end =
    currentState.finishedAtMs ?? estimatedServerNow;

  const elapsed = Math.max(0, end - currentState.startedAtMs);
  const penalty = currentState.penaltySeconds * 1000;

  $("timing").textContent =
    `Solving time: ${formatTime(elapsed)} · ` +
    `Penalties: +${formatTime(penalty)} · ` +
    `Scored time: ${formatTime(elapsed + penalty)}`;
}

function renderState(state) {
  currentState = state;

  clockAnchor = {
    serverNowMs: state.serverNowMs,
    localPerformanceMs: performance.now(),
  };

  const started = state.status !== "notStarted";
  const finished = state.status === "finished";

  $("challenge-title").textContent = state.title;
  $("pre-start").hidden = started;
  $("attempt-section").hidden = !started;

  $("clue").textContent = state.clue || "";
  $("completion").textContent = finished ? "Challenge completed!" : "";
  $("answer-form").hidden = !started || finished;

  $("hints").replaceChildren();

  for (const [index, hint] of (state.hints || []).entries()) {
    const card = document.createElement("div");
    card.className = "card";

    const heading = document.createElement("strong");
    heading.textContent =
      `Hint ${index + 1} (+${formatTime(hint.penaltySeconds * 1000)})`;

    const text = document.createElement("p");
    text.className = "hint-text";
    text.textContent = hint.text;

    card.append(heading, text);
    $("hints").append(card);
  }

  const nextPenalty = state.nextHintPenaltySeconds;

  $("hint-button").hidden =
    !started || finished || nextPenalty == null;

  if (nextPenalty != null) {
    $("hint-button").textContent =
      `Reveal next hint (+${formatTime(nextPenalty * 1000)})`;
  }

  updateClock();
}

async function sendAction(action, extra = {}) {
  if (!challengeId) {
    throw new Error("Scan a station QR code before opening a challenge.");
  }

  const requestUid = auth.currentUser?.uid;
  const result = await callGame({
    action,
    challengeId,
    ...extra,
  });

  if (auth.currentUser?.uid === requestUid) {
    renderState(result.data);
  }

  return result.data;
}

async function loadChallenge() {
  if (!challengeId) {
    currentState = null;
    $("station-prompt").hidden = false;
    $("challenge-content").hidden = true;
    $("refresh-button").hidden = true;
    showMessage("");
    return;
  }

  $("station-prompt").hidden = true;
  $("challenge-content").hidden = false;
  $("refresh-button").hidden = false;
  currentState = null;
  $("pre-start").hidden = true;
  $("attempt-section").hidden = true;
  $("challenge-title").textContent = "Loading…";
  $("answer").value = "";
  clearAnswerFeedback();

  await sendAction("state");
}

async function handleAuthChange(user) {
  const uid = user?.uid || null;
  if (uid === activeUid) return;
  activeUid = uid;

  currentState = null;
  $("login-section").hidden = Boolean(user);
  $("game-section").hidden = !user;

  if (!user) {
    $("signed-in").textContent = "";
    showLoginMessage("Scan your team login QR code to sign in.");
    return;
  }

  $("signed-in").textContent = `Signed in as ${user.email}`;
  showLoginMessage("");
  setBusy(true);

  loadChallenge()
    .catch((error) => {
      console.error(error);
      showMessage(error.message || "Could not load challenge.");
    })
    .finally(() => setBusy(false));
}

async function initializeSession(user) {
  if (teamQr.invalid) {
    if (user) await signOut(auth);
    user = null;
    showLoginMessage("This team QR code is incomplete. Ask the organizer for a new one.");
  } else if (teamQr.credentials) {
    showLoginMessage("Signing in with your team QR code…");

    try {
      const result = await signInWithEmailAndPassword(
        auth,
        teamQr.credentials.email,
        teamQr.credentials.password
      );
      user = result.user;
      showLoginMessage("");
    } catch (error) {
      console.error(error);
      if (auth.currentUser) await signOut(auth);
      user = null;
      showLoginMessage("This team QR code could not sign in. Ask the organizer for help.");
    }
  }

  authStartupComplete = true;
  await handleAuthChange(user);
}

let initialAuthState = true;
onAuthStateChanged(auth, (user) => {
  if (initialAuthState) {
    initialAuthState = false;
    initializeSession(user).catch((error) => {
      console.error(error);
      authStartupComplete = true;
      showLoginMessage("Could not initialize sign-in. Refresh and scan your team QR again.");
    });
    return;
  }

  if (authStartupComplete) {
    handleAuthChange(user);
  }
});

$("refresh-button").addEventListener("click", () => {
  perform(loadChallenge);
});

$("start-button").addEventListener("click", () => {
  perform(() => sendAction("start"));
});

$("hint-button").addEventListener("click", () => {
  if (busy || !currentState) return;

  const penalty = currentState.nextHintPenaltySeconds;
  if (penalty == null) return;

  const confirmed = window.confirm(
    `Reveal the next hint?\n\n` +
    `This adds ${formatTime(penalty * 1000)} to your score.\n` +
    `The solving timer will continue running.`
  );

  if (!confirmed) return;

  const hintIndex = currentState.hints.length;

  perform(() => sendAction("hint", { hintIndex }));
});

$("answer-form").addEventListener("submit", (event) => {
  event.preventDefault();
  clearAnswerFeedback();

  perform(async () => {
    const result = await sendAction("answer", {
      answer: $("answer").value,
    });

    if (result.correct === false) {
      showAnswerFeedback("Incorrect answer. Try again.");
    } else if (result.status === "finished") {
      showMessage("Correct! Your time has been recorded.");
      $("answer").value = "";
    }
  });
});

$("answer").addEventListener("input", clearAnswerFeedback);

$("logout-button").addEventListener("click", () => {
  perform(() => signOut(auth));
});

setInterval(updateClock, 250);