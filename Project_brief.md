

Copy the following into your VS Code AI agent:

---

# Project brief: Scavenger hunt website

Help me build this project incrementally in VS Code. **Inspect the workspace first; the design below was proposed in a chat, but files and Firebase resources may not exist yet. Do not assume anything has been implemented.**

## Purpose

A scavenger hunt for **4 adult teams of 4 people**, competing in **5 escape-room-style challenges**.

Each challenge is timed independently, excluding travel time.

Physical materials will be duplicated, so teams do not need to share props.

## Chosen stack

- **Frontend:** plain HTML, CSS, and JavaScript, hosted on **GitHub Pages**.
- **Authentication:** Firebase Email/Password, with four organizer-created team accounts. Teams sign in by scanning a private team QR code that contains their account credentials.
- **Database:** Cloud Firestore.
- **Backend:** Firebase callable Cloud Functions, JavaScript, Node.js 22.
- Firebase Functions requires the **Blaze billing plan**. Explain billing implications before deployment. Alerts are not spending caps.
- Proposed function region: `europe-west1`; confirm the appropriate region with me before provisioning.

Avoid frameworks or build tooling unless there is a clear benefit.

## Gameplay requirements

1. Teams scan their private team login QR code to sign in with their assigned account.
2. Each station has a QR code linking to its challenge:
   `https://USERNAME.github.io/REPOSITORY/?challenge=challenge1`
3. Team login QRs and station challenge QRs are separate. A station QR selects the challenge; it does not authenticate the team.
4. Opening a challenge **does not start the timer**. There is no challenge selector in the website; teams switch challenges by scanning another station QR.
5. A preparation screen displays the title and a **Start challenge** button.
6. Starting records a server-controlled timestamp and reveals the first clue.
7. Refreshing, retrying Start, or switching devices resumes the same attempt.
8. Teams submit answers; a correct answer records the finish timestamp.
9. Incorrect answers leave the timer running and show brief, prominent feedback beside the answer field.
10. Progressive hints are available:
   - Revealed in order.
   - Each adds a fixed, cumulative time penalty.
   - Penalties may differ by hint and challenge.
   - Example: +60, +120, +240 seconds; all three total +420 seconds.
   - Confirmation must show the additional penalty.
   - Already purchased hints remain visible at no extra charge.
   - Hint requests must be idempotent under retries and concurrent devices.
11. Display solving time, hint penalties, and scored time separately.
12. Finished challenges cannot be restarted by teams.

Scoring:

**Scored time = finish − start + purchased hint penalties.**

Overall score is the sum of the five challenge scores; lowest wins.

## Security and correctness requirements

- Backend is authoritative for timestamps, answer validation, and penalties.
- Client timer is approximate and for display only.
- Never ship accepted answers or unrevealed hints in frontend files.
- Team login QR codes contain the team's email and password and are bearer credentials. Generate them locally, keep the QR images private, never commit credentials or QR images, and rotate team passwords after the event. A copied QR can be used by anyone who has it until the password is changed.
- Never commit service-account credentials or private keys.
- Firebase web configuration is public configuration, not an admin credential.
- Only authenticated users with a matching `teams/{uid}` document may play.
- No registration UI.
- Deny all direct client Firestore reads/writes; access goes through the backend.
- Validate all backend inputs and allow only known challenge IDs/actions.
- Use Firestore transactions for state changes and concurrency safety.
- A repeated Start must never reset the clock.
- A repeated hint purchase must never charge twice or accidentally buy another hint.
- Completed attempts are immutable through gameplay endpoints.
- Apply a short server-enforced answer submission cooldown, proposed as 3 seconds.
- Render puzzle text safely using `textContent`, not untrusted `innerHTML`.
- Do not change live puzzle definitions during an event unless versioning/snapshotting is implemented.

## Proposed Firestore model

### `teams/{firebaseAuthUid}`

- `name`: string

One document for each authorized team.

### `puzzles/{challengeId}`

IDs: `challenge1` through `challenge5`.

- `title`: string
- `clue`: string
- `answers`: array of accepted answer strings
- `hints`: ordered array of maps:
  - `text`: string
  - `penaltySeconds`: nonnegative integer

Answer normalization proposal:

- Unicode NFKC normalization.
- Trim surrounding whitespace.
- Collapse repeated internal whitespace.
- Case-insensitive comparison.
- Do not silently remove punctuation or all internal spaces; use explicit answer alternatives.

### `attempts/{uid}_{challengeId}`

- `teamUid`
- `teamName`
- `challengeId`
- `startedAt`: Firestore timestamp
- `finishedAt`: timestamp or null
- `hintsUsed`: integer
- `penaltySeconds`: integer
- `wrongAnswers`: integer
- `lastSubmissionAt`: timestamp or null
- On completion:
  - `elapsedMilliseconds`
  - `scoredMilliseconds`

Consider whether storing purchased hint text/penalties or a puzzle version is worthwhile before finalizing the schema. The initial proposal reads current puzzle definitions, so edits during play could cause inconsistencies.

## Proposed backend API

One authenticated callable function named `game`, with actions:

### `state`

Input: `challengeId`.

Returns safe current state. Before starting, return only title/status—not clue or hints.

### `start`

Input: `challengeId`.

Create the attempt once, or return existing state.

### `hint`

Input: `challengeId`, `hintIndex` (zero-based).

- If `hintIndex` is already purchased, return state without charging.
- If it is the next available hint, purchase it transactionally.
- Reject attempts to skip hints.
- Never purchase another hint as a side effect of retrying an earlier request.

### `answer`

Input: `challengeId`, `answer`.

Validate, enforce cooldown, compare normalized answers, and finish if correct.

### Safe response fields

As applicable:

- `status`: `notStarted`, `running`, or `finished`
- `title`
- `clue` only after starting
- `startedAtMs`
- `finishedAtMs`
- `penaltySeconds`
- Purchased hints only
- `nextHintPenaltySeconds`
- `serverNowMs`
- `correct` for answer responses

Use `performance.now()` anchored to a server response for a smooth frontend clock. Server timestamps determine final scores.

## Proposed repository layout

```text
/
  .firebaserc
  firebase.json
  firestore.rules
  firestore.indexes.json
  .gitignore
  README.md
  functions/
    package.json
    index.js
  tools/
    generate-team-qrs.js
  docs/
    index.html
    app.js
```

GitHub Pages should deploy `main` → `/docs`.

Firebase Hosting is not needed.

Use a consistent, supported Firebase browser SDK version across imports.

Ignore dependency folders, local environment files, Firebase local artifacts, and logs. Do not accidentally ignore example configuration files that should be committed.

## Frontend UI

- Team sign-in by scanning a private team QR code; no email/password form or registration UI.
- Signed-in identity and sign-out button.
- Challenge selected only by a valid station URL `?challenge=...`; no website challenge selector. If absent or invalid, prompt the team to scan a station QR.
- Refresh challenge button.
- Pre-start preparation screen.
- Start button.
- Clue display.
- Running/final timer and penalties.
- Purchased hints and “Reveal next hint” button.
- Answer form.
- Prominent incorrect-answer feedback beside the answer input that disappears after a few seconds.
- Clear completion and general error messages.
- Mobile-friendly, accessible layout.
- Disable conflicting interactions while a request is pending.
- Handle authentication initialization and async requests carefully; avoid stale responses overwriting a newly selected challenge.
- Provide recovery after uncertain network outcomes by reloading server state.

## Firebase setup assistance needed

Guide me through, without assuming it is already done:

1. Creating the Firebase project.
2. Choosing database/function regions.
3. Enabling billing if proceeding.
4. Enabling Email/Password Authentication.
5. Creating four team accounts with matching team allowlist documents, plus a separate organizer account with an `organizers/{uid}` document containing `role: "organizer"`; then generating private team login QRs locally with `npm run generate:team-qrs`.
6. Creating Firestore in production mode.
7. Registering the web app and adding its configuration.
8. Adding the GitHub Pages hostname to authorized domains.
9. Initializing and deploying Functions and Firestore rules.
10. Publishing GitHub Pages.

Prefer local Firebase Emulator Suite testing before production deployment, if practical.

## Testing checklist

- Scanning a team QR signs in; credentials are removed from the browser URL immediately.
- Scanning a station QR selects that challenge; no selector is available, and scanning does not start the timer.
- Invalid or incomplete team QR credentials do not grant access.
- Starting twice preserves original timestamp.
- Refresh/relogin/second device preserves progress.
- Correct answers finish once.
- Wrong answers do not finish.
- Cooldown is enforced server-side.
- Answer normalization works.
- Hints reveal progressively.
- Repeated/concurrent hint requests do not double-charge.
- Finished challenges cannot purchase hints or restart.
- Unauthorized users and direct database access are rejected.
- No hidden answers/hints appear in public assets or responses.
- Team QR images and passwords are absent from Git history and public assets; rotate team passwords after the event.
- Network failure followed by retry recovers authoritative state.
- Client clock manipulation does not alter stored scores.
- Test mobile devices and reception at actual stations.

## Organizer features and known limitations

The organizer overview at `/organizer.html` shows the status and timing summary for each team/challenge, hint penalties, hint count, wrong-answer count, and per-team completion count. It refreshes manually and does not permit edits or corrections.

Organizer access requires a separate Firebase Auth account and an `organizers/{uid}` Firestore document with `role: "organizer"`. The backend checks this allowlist before returning the overview. Firestore client rules continue denying direct client access.

Deleting an attempt document resets it; only an organizer should do this, preferably before the event.

Not yet designed/implemented:

- Audited manual time corrections.
- Automated leaderboard/export.
- Time limits or abandonment rules.
- Preventing simultaneous active challenges.
- Enforcing physical presence at a station.
- Offline operation.
- Puzzle versioning.

Do not add these automatically; discuss priorities.

## How to proceed

1. Inspect the workspace and report what exists.
2. Ask only the essential setup questions.
3. Propose a short implementation plan.
4. Build and test in small steps, starting with one team and one sample challenge.
5. Explain commands and configuration changes.
6. Ask before provisioning paid resources, deploying, deleting data, or making other consequential changes.
7. Maintain a README documenting setup, deployment, testing, puzzle entry, event-day operation, and reset procedures.

**The previous conversation supplied a prototype design, not a verified implementation. Review architecture and edge cases rather than reproducing it unquestioningly.** 