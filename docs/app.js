import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";

import {
    getAuth,
    onAuthStateChanged,
    signInWithEmailAndPassword,
    signOut,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";

import {
    getFunctions,
    httpsCallable,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-functions.js";

const firebaseConfig = {
  apiKey: "AIzaSyBD8s0hhfpPwTjI4pEvatt4ZdkQmoGU7Es",
  authDomain: "scavengerhunttimer.firebaseapp.com",
  projectId: "scavengerhunttimer",
  storageBucket: "scavengerhunttimer.firebasestorage.app",
  messagingSenderId: "335882140634",
  appId: "1:335882140634:web:52293c005f49dcf8305ee3"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

// Must match the backend region.
const functions = getFunctions(app, "europe-west1");
const callGame = httpsCallable(functions, "game");

const $ = (id) => document.getElementById(id);

let currentState = null;
let busy = false;
let clockAnchor = null;

const initialChallenge =
  new URLSearchParams(window.location.search).get("challenge");

if (
  ["challenge1", "challenge2", "challenge3", "challenge4", "challenge5"]
    .includes(initialChallenge)
) {
  $("challenge-select").value = initialChallenge;
}

function showMessage(text) {
  $("message").textContent = text;
}

function setBusy(value) {
  busy = value;

  document.querySelectorAll("button, select").forEach((element) => {
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
  const result = await callGame({
    action,
    challengeId: $("challenge-select").value,
    ...extra,
  });

  renderState(result.data);
  return result.data;
}

async function loadChallenge() {
  currentState = null;
  $("pre-start").hidden = true;
  $("attempt-section").hidden = true;
  $("challenge-title").textContent = "Loading…";
  $("answer").value = "";

  await sendAction("state");
}

$("login-form").addEventListener("submit", (event) => {
  event.preventDefault();

  perform(async () => {
    await signInWithEmailAndPassword(
      auth,
      $("email").value.trim(),
      $("password").value
    );

    $("password").value = "";
  });
});

onAuthStateChanged(auth, (user) => {
  $("login-section").hidden = Boolean(user);
  $("game-section").hidden = !user;
  currentState = null;

  if (!user) {
    $("signed-in").textContent = "";
    return;
  }

  $("signed-in").textContent = `Signed in as ${user.email}`;

  // This callback can run during the login operation.
  // Load separately rather than nesting another perform() call.
  setBusy(true);

  loadChallenge()
    .catch((error) => {
      console.error(error);
      showMessage(error.message || "Could not load challenge.");
    })
    .finally(() => setBusy(false));
});

$("challenge-select").addEventListener("change", () => {
  perform(loadChallenge);
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

  perform(async () => {
    const result = await sendAction("answer", {
      answer: $("answer").value,
    });

    if (result.correct === false) {
      showMessage("Not quite—try again.");
    } else if (result.status === "finished") {
      showMessage("Correct! Your time has been recorded.");
      $("answer").value = "";
    }
  });
});

$("logout-button").addEventListener("click", () => {
  perform(() => signOut(auth));
});

setInterval(updateClock, 250);