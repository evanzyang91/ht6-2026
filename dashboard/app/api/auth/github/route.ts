import { createHash, randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { dashboardUrl, OAUTH_STATE_COOKIE, OAUTH_VERIFIER_COOKIE, secureCookieOptions } from "@/lib/github-auth";

export const runtime = "nodejs";

export function GET(request: NextRequest) {
  const clientId = process.env.GITHUB_CLIENT_ID?.trim();
  if (!clientId || !process.env.GITHUB_CLIENT_SECRET?.trim() || !process.env.DASHBOARD_AUTH_SECRET?.trim()) {
    return NextResponse.redirect(dashboardUrl("/?auth_error=configuration", request.url));
  }
  const state = randomBytes(24).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const callback = dashboardUrl("/api/auth/github/callback", request.url).toString();
  const authorization = new URL("https://github.com/login/oauth/authorize");
  authorization.searchParams.set("client_id", clientId);
  authorization.searchParams.set("redirect_uri", callback);
  authorization.searchParams.set("scope", process.env.GITHUB_OAUTH_SCOPE?.trim() || "repo");
  authorization.searchParams.set("state", state);
  authorization.searchParams.set("code_challenge", challenge);
  authorization.searchParams.set("code_challenge_method", "S256");
  authorization.searchParams.set("prompt", "select_account");

  const response = NextResponse.redirect(authorization);
  response.cookies.set(OAUTH_STATE_COOKIE, state, secureCookieOptions(10 * 60));
  response.cookies.set(OAUTH_VERIFIER_COOKIE, verifier, secureCookieOptions(10 * 60));
  return response;
}
