import { NextRequest, NextResponse } from "next/server";
import {
  OAUTH_STATE_COOKIE,
  OAUTH_VERIFIER_COOKIE,
  SESSION_COOKIE,
  sealGitHubSession,
  secureCookieOptions,
  dashboardUrl,
} from "@/lib/github-auth";

export const runtime = "nodejs";

interface TokenResponse {
  access_token?: string;
  error?: string;
}

interface GitHubUser {
  login?: string;
  avatar_url?: string;
}

function finish(request: NextRequest, path: string): NextResponse {
  const response = NextResponse.redirect(dashboardUrl(path, request.url));
  response.cookies.delete(OAUTH_STATE_COOKIE);
  response.cookies.delete(OAUTH_VERIFIER_COOKIE);
  return response;
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const expectedState = request.cookies.get(OAUTH_STATE_COOKIE)?.value;
  const verifier = request.cookies.get(OAUTH_VERIFIER_COOKIE)?.value;
  if (!code || !state || !expectedState || state !== expectedState || !verifier) {
    return finish(request, "/?auth_error=invalid_state");
  }
  const clientId = process.env.GITHUB_CLIENT_ID?.trim();
  const clientSecret = process.env.GITHUB_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return finish(request, "/?auth_error=configuration");
  const redirectUri = dashboardUrl("/api/auth/github/callback", request.url).toString();

  try {
    const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
        code_verifier: verifier,
      }),
      cache: "no-store",
    });
    const tokenPayload = await tokenResponse.json() as TokenResponse;
    if (!tokenResponse.ok || !tokenPayload.access_token || tokenPayload.error) {
      return finish(request, "/?auth_error=token_exchange");
    }
    const userResponse = await fetch("https://api.github.com/user", {
      headers: {
        authorization: `Bearer ${tokenPayload.access_token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "engineering-memory-dashboard",
      },
      cache: "no-store",
    });
    const user = await userResponse.json() as GitHubUser;
    if (!userResponse.ok || !user.login) return finish(request, "/?auth_error=user_lookup");

    const response = finish(request, "/");
    response.cookies.set(SESSION_COOKIE, sealGitHubSession({
      accessToken: tokenPayload.access_token,
      login: user.login,
      avatarUrl: user.avatar_url ?? "",
      issuedAt: Date.now(),
    }), secureCookieOptions(7 * 24 * 60 * 60));
    return response;
  } catch {
    return finish(request, "/?auth_error=github_unavailable");
  }
}
