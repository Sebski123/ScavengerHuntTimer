const fs = require("node:fs/promises");
const path = require("node:path");
const QRCode = require("qrcode");

function ask(question, { hidden = false } = {}) {
  const input = process.stdin;

  if (!input.isTTY || typeof input.setRawMode !== "function") {
    return Promise.reject(
      new Error("Run this command in an interactive terminal.")
    );
  }

  return new Promise((resolve, reject) => {
    let value = "";
    const wasRaw = input.isRaw;

    function finish(error) {
      input.off("data", onData);
      input.setRawMode(wasRaw);
      process.stdout.write("\n");

      if (error) reject(error);
      else resolve(value);
    }

    function onData(chunk) {
      for (const character of chunk) {
        if (character === "\u0003") {
          finish(new Error("Cancelled."));
          return;
        }

        if (character === "\r" || character === "\n") {
          finish();
          return;
        }

        if (character === "\u007f" || character === "\b") {
          const characters = Array.from(value);
          if (characters.length > 0) {
            characters.pop();
            value = characters.join("");
            if (!hidden) process.stdout.write("\b \b");
          }
          continue;
        }

        if (character >= " " && character !== "\u001b") {
          value += character;
          if (!hidden) process.stdout.write(character);
        }
      }
    }

    process.stdout.write(question);
    input.setEncoding("utf8");
    input.setRawMode(true);
    input.resume();
    input.on("data", onData);
  });
}

function createTeamLoginUrl(baseUrl, email, password) {
  const url = new URL(baseUrl);

  if (url.protocol !== "https:" || url.search || url.hash) {
    throw new Error("Use an HTTPS GitHub Pages base URL without query or fragment.");
  }

  url.hash = new URLSearchParams({
    "team-login": "1",
    email,
    password,
  }).toString();

  return url.toString();
}

async function main() {
  const baseUrl = process.env.TEAM_QR_BASE_URL ||
    await ask("GitHub Pages base URL: ");
  const outputDir = path.resolve(__dirname, "..", "private-team-qrs");
  const existingFiles = await fs.readdir(outputDir).catch(() => []);
  const existingQrs = existingFiles.filter((name) => /^team-[1-4]\.png$/.test(name));

  if (existingQrs.length > 0) {
    const overwrite = (await ask("Replace existing team QR images? (y/N): "))
      .trim()
      .toLowerCase();
    if (overwrite !== "y") throw new Error("Cancelled; existing QR images were kept.");
  }

  await fs.mkdir(outputDir, { recursive: true });

  for (let index = 1; index <= 4; index += 1) {
    const email = (await ask(`Team ${index} email: `)).trim();
    const password = await ask(`Team ${index} password (hidden): `, { hidden: true });

    if (!email || !password) {
      throw new Error(`Team ${index} email and password must not be empty.`);
    }

    const loginUrl = createTeamLoginUrl(baseUrl, email, password);
    const image = await QRCode.toBuffer(loginUrl, {
      errorCorrectionLevel: "H",
      margin: 4,
      width: 512,
    });
    const filePath = path.join(outputDir, `team-${index}.png`);

    await fs.writeFile(filePath, image, { mode: 0o600 });
    console.log(`Generated ${path.relative(process.cwd(), filePath)}`);
  }

  console.log("Keep these QR images private and rotate the team passwords after the event.");
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { createTeamLoginUrl };
