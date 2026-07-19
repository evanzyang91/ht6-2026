export type MemoryStatus = "unprocessed" | "stale" | "ready" | "empty" | "failed";

export interface SidebarSnapshot {
  hasFolder: boolean;
  trusted: boolean;
  signedIn: boolean;
  /** Kept for callers that still branch on hosted-vs-local mode; not rendered in the UI. */
  apiUrl: string;
  repository?: string;
  repositoryError?: string;
  status?: MemoryStatus;
  conventionCount?: number;
  lastError?: string;
  statusError?: string;
  lastSyncAt?: number;
  lastSyncCommentCount?: number;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function statusLabel(snapshot: SidebarSnapshot): { text: string; tone: "ok" | "warn" | "error" | "muted" } {
  if (snapshot.statusError) return { text: `Unavailable — ${snapshot.statusError}`, tone: "error" };
  switch (snapshot.status) {
    case "ready":
      return { text: `${snapshot.conventionCount ?? 0} conventions compiled`, tone: "ok" };
    case "stale":
      return { text: "Refreshing…", tone: "warn" };
    case "empty":
      return { text: "Processed, no repeated conventions yet", tone: "muted" };
    case "failed":
      return { text: snapshot.lastError ? `Setup failed — ${snapshot.lastError}` : "Setup failed", tone: "error" };
    case "unprocessed":
      return { text: "Not indexed yet", tone: "muted" };
    default:
      return { text: "Unknown", tone: "muted" };
  }
}

function badgeWord(tone: "ok" | "warn" | "error" | "muted"): string {
  switch (tone) {
    case "ok": return "Ready";
    case "warn": return "Working";
    case "error": return "Action needed";
    case "muted": return "Not set up";
  }
}

function formatLastSync(snapshot: SidebarSnapshot): string {
  if (!snapshot.lastSyncAt) return "Never";
  const when = new Date(snapshot.lastSyncAt).toLocaleTimeString();
  return `${when} · ${snapshot.lastSyncCommentCount ?? 0} stored comments`;
}

function row(label: string, valueHtml: string, tone: "ok" | "warn" | "error" | "muted" = "muted"): string {
  return `<div class="row"><span class="dot ${tone}"></span><span class="row-label">${escapeHtml(label)}</span><span class="row-value">${valueHtml}</span></div>`;
}

type ButtonVariant = "danger" | "accent" | "warn" | "neutral";

function button(command: string, text: string, variant: ButtonVariant, disabled = false): string {
  return `<button data-command="${escapeHtml(command)}" class="btn-${variant}"${disabled ? " disabled" : ""}>${escapeHtml(text)}</button>`;
}

/** Pure HTML rendering, decoupled from `vscode` so it's directly unit-testable. */
export function renderSidebarHtml(snapshot: SidebarSnapshot, nonce: string): string {
  const buttons: string[] = [];
  const rows: string[] = [];
  let heroTone: "ok" | "warn" | "error" | "muted" = "muted";
  let heroHeadline = "";
  let heroDetail = "";

  if (!snapshot.hasFolder) {
    heroHeadline = "No folder open";
    heroDetail = "Open a repository to get started.";
  } else if (!snapshot.trusted) {
    heroTone = "error";
    heroHeadline = "Workspace not trusted";
    heroDetail = "Trust this workspace to enable Engineering Memory.";
    buttons.push(button("trustWorkspace", "Trust Workspace…", "danger"));
  } else {
    const memory = statusLabel(snapshot);
    heroTone = memory.tone;
    heroHeadline = memory.text;
    heroDetail = formatLastSync(snapshot) === "Never" ? "Never synced" : `Last sync: ${formatLastSync(snapshot)}`;

    rows.push(row("Repository", snapshot.repository
      ? escapeHtml(snapshot.repository)
      : `<span class="error">${escapeHtml(snapshot.repositoryError ?? "Not detected")}</span>`, snapshot.repository ? "ok" : "error"));

    rows.push(row("GitHub", snapshot.signedIn ? "Signed in" : "Not signed in", snapshot.signedIn ? "ok" : "muted"));
    if (!snapshot.signedIn) buttons.push(button("signIn", "Sign in to GitHub…", "accent"));

    const alreadySynced = snapshot.status === "ready";
    buttons.push(button(
      "initialize",
      snapshot.status === "failed" ? "Retry Setup" : alreadySynced ? "Initialize Repository Memory (up to date)" : "Initialize Repository Memory",
      "warn",
      alreadySynced,
    ));
    buttons.push(button("syncNow", "Sync Now", "neutral"));
    buttons.push(button("showMemory", "Show Current Memory & Log", "neutral"));
  }

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
<style>
  * { box-sizing: border-box; }
  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    padding: 12px;
    margin: 0;
  }
  .hero {
    padding: 14px;
    border-radius: 8px;
    background: var(--vscode-sideBarSectionHeader-background, var(--vscode-editorWidget-background));
    border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
    margin-bottom: 16px;
  }
  .hero-badge {
    display: inline-block;
    padding: 2px 9px;
    border-radius: 10px;
    font-size: 0.72em;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin-bottom: 9px;
  }
  .hero-badge.tone-ok { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  .hero-badge.tone-warn { background: var(--vscode-statusBarItem-warningBackground); color: var(--vscode-statusBarItem-warningForeground); }
  .hero-badge.tone-error { background: var(--vscode-statusBarItem-errorBackground); color: var(--vscode-statusBarItem-errorForeground); }
  .hero-badge.tone-muted { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
  .hero-headline { font-weight: 600; line-height: 1.4; }
  .hero-detail { color: var(--vscode-descriptionForeground); font-size: 0.9em; margin-top: 3px; }
  .section-title {
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-size: 0.78em;
    font-weight: 600;
    color: var(--vscode-descriptionForeground);
    margin: 0 0 6px 2px;
  }
  .rows { margin-bottom: 16px; }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 2px;
  }
  .dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; background: var(--vscode-descriptionForeground); }
  .dot.ok { background: var(--vscode-testing-iconPassed, #3fb950); }
  .dot.warn { background: var(--vscode-editorWarning-foreground); }
  .dot.error { background: var(--vscode-errorForeground); }
  .row-label { color: var(--vscode-descriptionForeground); flex: 1; }
  .row-value { text-align: right; word-break: break-word; }
  .ok { color: var(--vscode-testing-iconPassed, #3fb950); }
  .warn { color: var(--vscode-editorWarning-foreground); }
  .error { color: var(--vscode-errorForeground); }
  .muted { color: var(--vscode-descriptionForeground); }
  .actions { display: flex; flex-direction: column; gap: 6px; }
  button {
    font-family: inherit;
    font-size: inherit;
    padding: 7px 12px;
    border: 1px solid transparent;
    border-radius: 6px;
    cursor: pointer;
    text-align: center;
    font-weight: 500;
    transition: filter 0.1s ease-in-out, background 0.1s ease-in-out;
  }
  button:disabled {
    cursor: not-allowed;
    pointer-events: none;
    background: var(--vscode-button-secondaryBackground, var(--vscode-badge-background));
    color: var(--vscode-descriptionForeground);
  }
  /* Blocking prerequisite — must fix before anything else works. */
  .btn-danger {
    background: var(--vscode-statusBarItem-errorBackground);
    color: var(--vscode-statusBarItem-errorForeground);
  }
  .btn-danger:hover { filter: brightness(1.15); }
  /* Primary call to action. */
  .btn-accent {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
  }
  .btn-accent:hover { background: var(--vscode-button-hoverBackground); }
  /* One-time setup action. */
  .btn-warn {
    background: var(--vscode-statusBarItem-warningBackground);
    color: var(--vscode-statusBarItem-warningForeground);
  }
  .btn-warn:hover { filter: brightness(1.1); }
  /* Routine, repeatable action. */
  .btn-neutral {
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
  }
  .btn-neutral:hover { background: var(--vscode-button-secondaryHoverBackground); }
</style>
</head>
<body>
  <div class="hero">
    <span class="hero-badge tone-${heroTone}">${escapeHtml(badgeWord(heroTone))}</span>
    <div class="hero-headline">${escapeHtml(heroHeadline)}</div>
    <div class="hero-detail">${escapeHtml(heroDetail)}</div>
  </div>
  ${rows.length ? `<div class="section-title">Details</div><div class="rows">${rows.join("")}</div>` : ""}
  <div class="section-title">Actions</div>
  <div class="actions">${buttons.join("")}</div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    document.querySelectorAll("button[data-command]").forEach((el) => {
      el.addEventListener("click", () => vscode.postMessage({ command: el.getAttribute("data-command") }));
    });
  </script>
</body>
</html>`;
}

export function nonce(): string {
  let text = "";
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) text += possible.charAt(Math.floor(Math.random() * possible.length));
  return text;
}
