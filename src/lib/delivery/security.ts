import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/** Authentication for the EZPZTEK simulator only; NOT foodpanda's protocol. */
export function verifySandboxSignature(
  body: string, timestamp: string | null, signature: string | null,
  secret: string | undefined, now = Date.now(),
): boolean {
  if (!secret || secret.length < 32 || !timestamp || !/^\d{10}$/.test(timestamp) || !signature || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  if (Math.abs(now / 1000 - Number(timestamp)) > 300) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest();
  return timingSafeEqual(expected, Buffer.from(signature, "hex"));
}
export function verifyWorkerToken(header: string | null, secret: string | undefined): boolean {
  if (!secret || secret.length < 32 || !header?.startsWith("Bearer ") || header.length > 512) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(header.slice(7)), digest(secret));
}
export async function readLimitedBody(request: Request, maximum = 65_536): Promise<string> {
  const length = request.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > maximum)) throw new Error("BODY_TOO_LARGE");
  if (!request.body) throw new Error("EMPTY_BODY");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) {
        await reader.cancel();
        throw new Error("BODY_TOO_LARGE");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks).toString("utf8");
}
