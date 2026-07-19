import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";

export const SESSION_COOKIE = "engineering_memory_github_session";
export const OAUTH_STATE_COOKIE = "engineering_memory_oauth_state";
export const OAUTH_VERIFIER_COOKIE = "engineering_memory_oauth_verifier";

export interface GitHubSession {
  accessToken: string;
  login: string;
  avatarUrl: string;
  issuedAt: number;
}

export function dashboardUrl(path: string, requestUrl: string): URL {
  const configured = process.env.DASHBOARD_BASE_URL?.trim();
  return new URL(path, configured || new URL(requestUrl).origin);
}

function authKey(): Buffer {
  const secret = process.env.DASHBOARD_AUTH_SECRET?.trim();
  if (!secret) throw new Error("DASHBOARD_AUTH_SECRET is required for GitHub authentication");
  return createHash("sha256").update(secret).digest();
}

export function sealGitHubSession(session: GitHubSession): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", authKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(session), "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((value) => value.toString("base64url")).join(".");
}

export function unsealGitHubSession(value: string): GitHubSession | undefined {
  try {
    const [ivValue, tagValue, ciphertextValue] = value.split(".");
    if (!ivValue || !tagValue || !ciphertextValue) return undefined;
    const decipher = createDecipheriv("aes-256-gcm", authKey(), Buffer.from(ivValue, "base64url"));
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ciphertextValue, "base64url")),
      decipher.final(),
    ]).toString("utf8");
    const parsed: unknown = JSON.parse(plaintext);
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const session = parsed as Partial<GitHubSession>;
    if (typeof session.accessToken !== "string" || typeof session.login !== "string"
      || typeof session.avatarUrl !== "string" || typeof session.issuedAt !== "number") return undefined;
    return session as GitHubSession;
  } catch {
    return undefined;
  }
}

export async function readGitHubSession(): Promise<GitHubSession | undefined> {
  const value = (await cookies()).get(SESSION_COOKIE)?.value;
  return value ? unsealGitHubSession(value) : undefined;
}

export function secureCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  };
}
