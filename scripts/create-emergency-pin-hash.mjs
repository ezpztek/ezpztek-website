import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Writable } from "node:stream";
import { createInterface } from "node:readline/promises";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);

if (!process.stdin.isTTY) {
  console.error("Run this command in an interactive terminal.");
  process.exit(1);
}

let muted = false;
const hiddenOutput = new Writable({
  write(chunk, encoding, callback) {
    if (!muted) process.stdout.write(chunk, encoding);
    callback();
  },
});
const prompt = createInterface({
  input: process.stdin,
  output: hiddenOutput,
  terminal: true,
});

async function askForSecret(label) {
  process.stdout.write(label);
  muted = true;
  try {
    return await prompt.question("");
  } finally {
    muted = false;
    process.stdout.write("\n");
  }
}

try {
  console.log("Choose a NEW emergency PIN. Do not reuse a PIN shared in chat.");
  const pin = await askForSecret("Emergency PIN (6–12 digits): ");
  const confirmation = await askForSecret("Confirm emergency PIN: ");

  if (!/^\d{6,12}$/.test(pin)) {
    console.error("The PIN must contain 6–12 digits.");
    process.exitCode = 1;
  } else if (pin !== confirmation) {
    console.error("The PINs do not match.");
    process.exitCode = 1;
  } else {
    const salt = randomBytes(16);
    const hash = await scrypt(pin, salt, 64);
    const envLine = `ADMIN_EMERGENCY_PIN_HASH=scrypt:${salt.toString("base64url")}:${Buffer.from(hash).toString("base64url")}`;
    const envPath = resolve(process.cwd(), ".env.local");
    let envContents;

    try {
      envContents = await readFile(envPath, "utf8");
    } catch {
      console.error(".env.local was not found in the current project folder.");
      process.exitCode = 1;
      process.exit();
    }

    const updatedContents = /^ADMIN_EMERGENCY_PIN_HASH=.*$/m.test(envContents)
      ? envContents.replace(/^ADMIN_EMERGENCY_PIN_HASH=.*$/m, envLine)
      : `${envContents.trimEnd()}\n${envLine}\n`;

    await writeFile(envPath, updatedContents, "utf8");
    console.log("\nEmergency PIN updated securely in .env.local.");
    console.log("Restart the local server before testing the new PIN.");
    console.log("For Vercel, generate the hash there separately or copy only the hash value from .env.local.");
  }
} finally {
  prompt.close();
}
