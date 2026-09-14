// Deterministic privacy rule (R5): Night Door describes clothing, carried items and direction only.
// It never infers identity or personal traits from an image.

const SENSITIVE =
  /\b(age|aged|elderly|old|older|young|younger|senior|man|men|woman|women|male|female|boy|girl|gender|race|racial|ethnic\w*|asian|hispanic|latin[oax]|caucasian|african|skin|face|facial|hair|beard|bald|religio\w*|disabled|disability|overweight|obese|tall|identity|identified|recogni[sz]ed?)\b/i;

export function sensitiveTerm(text: string): string | null {
  const m = text.match(SENSITIVE);
  return m ? m[0].toLowerCase() : null;
}

export function redactField(value: string): { value: string; redacted: string | null } {
  const hit = sensitiveTerm(value);
  return hit ? { value: "not described (privacy)", redacted: hit } : { value, redacted: null };
}
