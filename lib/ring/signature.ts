import crypto from "node:crypto";

// Ring signs every webhook: X-Signature: sha256=<hex HMAC-SHA256(hmac_signing_key, raw_request_body)>

export function signBody(rawBody: string, key: string): string {
  return "sha256=" + crypto.createHmac("sha256", key).update(rawBody, "utf8").digest("hex");
}

export function verifySignature(rawBody: string, header: string | null | undefined, key: string): boolean {
  if (!header || !key) return false;
  const expected = Buffer.from(signBody(rawBody, key));
  const received = Buffer.from(header.trim());
  return expected.length === received.length && crypto.timingSafeEqual(expected, received);
}
