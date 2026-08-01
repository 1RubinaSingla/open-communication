import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Dev auth: a signed `userId.signature` token. Real Privy/JWT drops in behind
 * the same verify() call later without changing any call site.
 */
export function makeAuth(secret: string) {
  function sign(userId: string): string {
    const sig = createHmac("sha256", secret).update(userId).digest("base64url");
    return `${Buffer.from(userId).toString("base64url")}.${sig}`;
  }

  function verify(token: string | undefined): string | null {
    if (!token) return null;
    const [idPart, sig] = token.split(".");
    if (!idPart || !sig) return null;
    let userId: string;
    try {
      userId = Buffer.from(idPart, "base64url").toString("utf8");
    } catch {
      return null;
    }
    const expected = createHmac("sha256", secret).update(userId).digest("base64url");
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    return userId;
  }

  return { sign, verify };
}

export type Auth = ReturnType<typeof makeAuth>;
