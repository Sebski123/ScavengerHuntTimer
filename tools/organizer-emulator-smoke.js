const assert = require("node:assert/strict");

const projectId = "demo-scavenger-hunt";
const authUrl = "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key";
const firestoreUrl = `http://127.0.0.1:8080/v1/projects/${projectId}/databases/default/documents`;
const callableUrl = `http://127.0.0.1:5001/${projectId}/europe-west1/organizerOverview`;

async function signUp(email) {
  const response = await fetch(authUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "emulator-only-password", returnSecureToken: true }),
  });
  const body = await response.json();
  assert.equal(response.ok, true, JSON.stringify(body));
  return body;
}

async function putDocument(collection, id, fields) {
  const response = await fetch(`${firestoreUrl}/${collection}/${id}`, {
    method: "PATCH",
    headers: {
      Authorization: "Bearer owner",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fields }),
  });
  const body = await response.json();
  assert.equal(response.ok, true, JSON.stringify(body));
}

async function callOverview(idToken) {
  const headers = { "Content-Type": "application/json" };
  if (idToken) headers.Authorization = `Bearer ${idToken}`;
  const response = await fetch(callableUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({ data: {} }),
  });
  return { response, body: await response.json() };
}

async function main() {
  assert.ok(projectId.startsWith("demo-"), "Refusing to run against a non-demo project.");

  const unauthenticated = await callOverview();
  assert.equal(unauthenticated.body.error?.status, "UNAUTHENTICATED");

  const organizer = await signUp("organizer@example.test");
  const nonOrganizer = await signUp("player@example.test");
  await putDocument("organizers", organizer.localId, {
    role: { stringValue: "organizer" },
  });
  await putDocument("teams", "team-uid-one", {
    name: { stringValue: "Team One" },
  });

  const now = Date.now();
  for (let index = 1; index <= 5; index += 1) {
    await putDocument("puzzles", `challenge${index}`, {
      title: { stringValue: `Challenge ${index}` },
      clue: { stringValue: "PRIVATE CLUE SHOULD NEVER BE RETURNED" },
      answers: { arrayValue: { values: [{ stringValue: "PRIVATE ANSWER" }] } },
      hints: { arrayValue: { values: [{ mapValue: { fields: { text: { stringValue: "PRIVATE HINT" } } } }] } },
    });
  }

  await putDocument("attempts", "team-uid-one_challenge1", {
    startedAt: { timestampValue: new Date(now - 65000).toISOString() },
    finishedAt: { timestampValue: new Date(now - 5000).toISOString() },
    elapsedMilliseconds: { integerValue: "60000" },
    scoredMilliseconds: { integerValue: "70000" },
    hintsUsed: { integerValue: "1" },
    penaltySeconds: { integerValue: "10" },
    wrongAnswers: { integerValue: "2" },
  });
  await putDocument("attempts", "team-uid-one_challenge2", {
    startedAt: { timestampValue: new Date(now - 30000).toISOString() },
    finishedAt: { nullValue: null },
    hintsUsed: { integerValue: "0" },
    penaltySeconds: { integerValue: "0" },
    wrongAnswers: { integerValue: "1" },
  });

  const denied = await callOverview(nonOrganizer.idToken);
  assert.equal(denied.body.error?.status, "PERMISSION_DENIED");

  const authorized = await callOverview(organizer.idToken);
  assert.equal(authorized.response.ok, true, JSON.stringify(authorized.body));
  const overview = authorized.body.result;
  assert.equal(overview.teams.length, 1);
  assert.equal(overview.teams[0].name, "Team One");
  assert.equal(overview.teams[0].completedChallenges, 1);
  assert.equal(overview.teams[0].attempts.length, 5);
  assert.equal(overview.teams[0].attempts[0].status, "finished");
  assert.equal(overview.teams[0].attempts[0].scoredMilliseconds, 70000);
  assert.equal(overview.teams[0].attempts[1].status, "running");
  assert.equal(overview.teams[0].attempts[2].status, "notStarted");
  assert.equal(overview.challenges.length, 5);
  assert.doesNotMatch(
    JSON.stringify(overview),
    /PRIVATE CLUE|PRIVATE ANSWER|PRIVATE HINT|team-uid-one|organizer@example\.test/
  );

  console.log("Organizer callable emulator smoke test passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
