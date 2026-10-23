# Scavenger Hunt Timer

A static GitHub Pages client backed by Firebase Authentication, Cloud Firestore, and a callable Cloud Function. The callable is authoritative for attempt state, answer validation, timestamps, and hint penalties.

## Current Firebase layout

- Firebase project: `scavengerhunttimer`
- Firestore database: `default` in `nam5`
- Callable function: `game` in `europe-west1`, Node.js 22
- GitHub Pages source: branch `main`, folder `/docs`

The browser Firebase configuration in `docs/app.js` is public app configuration, not an admin credential. Never put service-account keys or admin credentials in the frontend.

## Team Sign-In QR Codes

Teams use a separate private login QR, then scan a public station QR to select the challenge. The website has no email/password form or challenge selector. A missing or invalid `?challenge=` parameter shows a prompt to scan a station QR; selecting a station never starts its timer.

Create four Email/Password users in Firebase Authentication. For each user, create `teams/{firebaseAuthUid}` with a `name` string. Only those UIDs are authorized to use the game callable.

Generate the four team login QR images on a trusted organizer computer:

```powershell
npm install
npm run generate:team-qrs
```

Enter the GitHub Pages base URL when prompted, followed by each team's email and password. Password entry is masked. The script writes `private-team-qrs/team-1.png` through `team-4.png`; `.gitignore` excludes this directory. Do not run the script on a shared or public computer, commit these images, or put the credentials in source files, issue trackers, or chat.

The login QR contains the team's email and password in the URL fragment. The page removes the fragment from the address bar before making the Firebase sign-in request, so it is not sent to GitHub Pages as part of the HTTP request. **The QR is still a bearer credential, not encryption:** anyone who photographs or copies it can sign in as that team. Keep printed and digital copies private. Firebase Auth sessions persist on a device after sign-in, so scanning another station QR does not require signing in again. Sign-out clears the current device's session, not the printed QR.

After the event, change each team's Firebase password and verify that the old QR no longer works. Sign out event devices and revoke refresh tokens when appropriate. Reissue a QR by rerunning the generator with the new password; it asks before replacing existing files.

## Station QR Codes

Create five public station links, changing the challenge ID for each station:

```text
https://USERNAME.github.io/REPOSITORY/?challenge=challenge1
https://USERNAME.github.io/REPOSITORY/?challenge=challenge2
https://USERNAME.github.io/REPOSITORY/?challenge=challenge3
https://USERNAME.github.io/REPOSITORY/?challenge=challenge4
https://USERNAME.github.io/REPOSITORY/?challenge=challenge5
```

Replace `USERNAME` and `REPOSITORY` with the GitHub Pages owner and repository. These QR codes select challenges only; they do not authenticate a team or prove physical presence. Teams first scan their private login QR, then scan the station QR. To switch stations, scan the next station QR. Only a valid challenge ID loads game state.

## Puzzle Data

Store each puzzle in Firestore as `puzzles/challenge1` through `puzzles/challenge5`, with `title`, `clue`, `answers` (accepted strings), and ordered `hints` (each containing `text` and a nonnegative integer `penaltySeconds`). Keep answers and unrevealed hints out of frontend files. Do not edit live puzzle definitions during an event; the current attempt model does not snapshot puzzle versions or hint text.

Attempt documents are created by the callable as `attempts/{uid}_{challengeId}`. Teams cannot directly read or write Firestore; the Admin SDK callable checks Firebase Auth and the matching `teams/{uid}` allowlist document.

## Organizer Overview

The organizer dashboard is available at `/organizer.html` after publishing the `docs/` folder. Create a separate Firebase Email/Password account for each organizer; do not use a team account or a team login QR.

To authorize an organizer, find the Firebase Auth user's UID in the Firebase Console, then create a Firestore document at `organizers/{uid}` with this field:

```json
{
	"role": "organizer"
}
```

The `organizerOverview` callable checks this document before reading team, puzzle-title, or attempt data. Firestore client rules remain deny-all. The dashboard shows a team-by-challenge table with status, elapsed and scored time, hint count and penalty, wrong-answer count, and completed challenge progress. Running times tick locally from the last server response; use **Refresh overview** to fetch authoritative current state. This is a read-only view, not a leaderboard or correction tool.

An authenticated team account without an `organizers/{uid}` document is denied. The callable supports at most four teams and reports an error if more are configured. Missing attempts appear as not started. Puzzle answers, clues, and hint text are not returned.

## Deploying

GitHub Pages serves the static frontend from `main` → `/docs`. Firebase Hosting is not used. Before deploying Cloud Functions, confirm the project is on the Blaze plan and review expected usage and billing. Budget alerts are notifications, not spending caps. The project already has a Node.js 22 callable in `europe-west1`.

After reviewing the target project and changes, deploy the function and rules with the Firebase CLI:

```powershell
npx -y firebase-tools@latest deploy --only functions,firestore:rules --project scavengerhunttimer
```

Deployment changes live resources; do not run it without organizer approval. Confirm the GitHub Pages hostname is listed under Firebase Authentication's authorized domains. Keep Email/Password enabled for the team accounts.

## Checks and Event-Day Operation

Syntax checks for the client and local QR generator:

```powershell
node --check docs/app.js
node --check tools/generate-team-qrs.js
```

Run the organizer callable smoke test against isolated Firebase emulators:

```powershell
npm run test:organizer-emulator
```

This test uses the `demo-scavenger-hunt` project ID and generated fixture accounts/data; it does not access production. The Firebase Emulator Suite requires JDK 21 or newer.

Before the event, verify each team QR signs into the expected team, and that a station QR loads only its requested challenge. Confirm that scanning does not start a timer, repeated starts resume the original timestamp, hints remain progressive and charge once, wrong answers keep the timer running, and finished attempts cannot restart. Check the Firebase console for the four `teams` documents and five puzzle documents. Test on the actual mobile devices and network conditions expected at the stations.

If a team loses connectivity, refresh the challenge to reload authoritative state. A lost or exposed login QR should be treated as a compromised team password: change that account's password, then generate a replacement QR. Only organizers should delete attempt documents to reset attempts, and should do so before play begins.

The organizer callable has an emulator smoke test. There is no full automated gameplay test suite yet; emulator-based tests should be expanded before relying on changes that affect scoring or authorization.
