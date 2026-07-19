import { NextRequest, NextResponse } from "next/server";
import { dashboardUrl, SESSION_COOKIE } from "@/lib/github-auth";

export function GET(request: NextRequest) {
  const response = NextResponse.redirect(dashboardUrl("/", request.url));
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
