import { expect, it } from "vitest";
import { renderSidebarHtml, type SidebarSnapshot } from "../src/sidebarView.js";

const base: SidebarSnapshot = {
  hasFolder: true,
  trusted: true,
  signedIn: true,
  apiUrl: "http://127.0.0.1:8790/graphql",
  repository: "acme/api",
  status: "empty",
  conventionCount: 0,
  lastSyncAt: Date.parse("2026-01-01T00:00:00Z"),
  lastSyncCommentCount: 40,
};

it("prompts to trust the workspace when untrusted, and hides other actions", () => {
  const html = renderSidebarHtml({ ...base, trusted: false }, "nonce");
  expect(html).toContain('data-command="trustWorkspace"');
  expect(html).not.toContain('data-command="signIn"');
  expect(html).not.toContain('data-command="initialize"');
  expect(html).not.toContain('data-command="syncNow"');
});

it("prompts to sign in to GitHub when no session is present", () => {
  const html = renderSidebarHtml({ ...base, signedIn: false }, "nonce");
  expect(html).toContain('data-command="signIn"');
});

it("labels the initialize button 'Retry Setup' when setup previously failed", () => {
  const html = renderSidebarHtml({ ...base, status: "failed", lastError: "GitHub token expired" }, "nonce");
  expect(html).toContain("Retry Setup");
  expect(html).not.toContain("Initialize Repository Memory");
  expect(html).toContain("GitHub token expired");
});

it("labels the initialize button 'Initialize Repository Memory' and keeps it enabled when not yet synced", () => {
  const html = renderSidebarHtml(base, "nonce");
  expect(html).toContain(">Initialize Repository Memory<");
  expect(html).not.toContain("Retry Setup");
  const initializeButton = html.match(/<button data-command="initialize"[^>]*>/)?.[0] ?? "";
  expect(initializeButton).not.toContain("disabled");
});

it("grays out (disables) the initialize button once the repository is already synced and ready", () => {
  const html = renderSidebarHtml({ ...base, status: "ready", conventionCount: 12 }, "nonce");
  const initializeButton = html.match(/<button data-command="initialize"[^>]*>/)?.[0] ?? "";
  expect(initializeButton).toContain("disabled");
  expect(html).toContain("up to date");
});

it("no longer renders a separate output-log button — Show Current Memory covers it", () => {
  const html = renderSidebarHtml(base, "nonce");
  expect(html).not.toContain('data-command="openLog"');
  expect(html).toContain('data-command="showMemory"');
});

it("renders no action buttons when no folder is open", () => {
  const html = renderSidebarHtml({ hasFolder: false, trusted: false, signedIn: false, apiUrl: "" }, "nonce");
  expect(html).not.toContain("data-command=");
  expect(html).toContain("No folder open");
});

it("escapes repository names and errors before embedding them in HTML", () => {
  const html = renderSidebarHtml({
    ...base,
    repository: undefined,
    repositoryError: '<script>alert("x")</script>',
  }, "nonce");
  expect(html).not.toContain("<script>alert");
  expect(html).toContain("&lt;script&gt;");
});

it("includes the CSP nonce on the inline script tag", () => {
  const html = renderSidebarHtml(base, "abc123");
  expect(html).toContain('nonce="abc123"');
});
