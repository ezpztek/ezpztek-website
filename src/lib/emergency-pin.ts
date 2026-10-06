import { scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const HASH_PREFIX = "scrypt";

export async function verifyEmergencyPin(pin: string, encodedHash: string) {
  const [prefix, saltValue, hashValue] = encodedHash.split(":");

  if (prefix !== HASH_PREFIX || !saltValue || !hashValue) return false;

  try {
    const salt = Buffer.from(saltValue, "base64url");
    const expectedHash = Buffer.from(hashValue, "base64url");
    const actualHash = (await scrypt(pin, salt, expectedHash.length)) as Buffer;

    return (
      actualHash.length === expectedHash.length &&
      timingSafeEqual(actualHash, expectedHash)
    );
  } catch {
    return false;
  }
}

