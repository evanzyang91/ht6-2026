export type MemoryStatus = "unprocessed" | "stale" | "ready" | "empty" | "failed";

export interface SidebarSnapshot {
  hasFolder: boolean;
  trusted: boolean;
  signedIn: boolean;
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

function formatLastSync(snapshot: SidebarSnapshot): string {
  if (!snapshot.lastSyncAt) return "Never";
  const when = new Date(snapshot.lastSyncAt).toLocaleTimeString();
  return `${when} · ${snapshot.lastSyncCommentCount ?? 0} stored comments`;
}

function row(label: string, valueHtml: string): string {
  return `<div class="row"><span class="row-label">${escapeHtml(label)}</span><span class="row-value">${valueHtml}</span></div>`;
}

function button(command: string, text: string, primary = false): string {
  return `<button data-command="${escapeHtml(command)}" class="${primary ? "primary" : ""}">${escapeHtml(text)}</button>`;
}

/** Pure HTML rendering, decoupled from `vscode` so it's directly unit-testable. */
export function renderSidebarHtml(snapshot: SidebarSnapshot, nonce: string): string {
  const buttons: string[] = [];
  const rows: string[] = [];

  if (!snapshot.hasFolder) {
    rows.push(row("Workspace", `<span class="muted">No folder open</span>`));
  } else {
    rows.push(row("Trust", snapshot.trusted
      ? `<span class="ok">Trusted</span>`
      : `<span class="error">Not trusted</span>`));
    if (!snapshot.trusted) buttons.push(button("trustWorkspace", "Trust Workspace…", true));
  }

  if (snapshot.hasFolder && snapshot.trusted) {
    rows.push(row("Repository", snapshot.repository
      ? `<span class="ok">${escapeHtml(snapshot.repository)}</span>`
      : `<span class="error">${escapeHtml(snapshot.repositoryError ?? "Not detected")}</span>`));

    rows.push(row("GitHub", snapshot.signedIn
      ? `<span class="ok">Signed in</span>`
      : `<span class="muted">Not signed in</span>`));
    if (!snapshot.signedIn) buttons.push(button("signIn", "Sign in to GitHub…", true));

    rows.push(row("API mode", snapshot.apiUrl
      ? `Hosted API — ${escapeHtml(snapshot.apiUrl)}`
      : `Local JSON store`));

    const memory = statusLabel(snapshot);
    rows.push(row("Memory status", `<span class="${memory.tone}">${escapeHtml(memory.text)}</span>`));

    rows.push(row("Last sync", `<span class="muted">${escapeHtml(formatLastSync(snapshot))}</span>`));

    buttons.push(button("initialize", snapshot.status === "failed" ? "Retry Setup" : "Initialize Repository Memory"));
    buttons.push(button("syncNow", "Sync Now"));
    buttons.push(button("showMemory", "Show Current Memory"));
  }

  buttons.push(button("openLog", "Open Output Log"));

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
<style>
  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    padding: 8px 4px;
  }
  .row {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    padding: 4px 0;
    border-bottom: 1px solid var(--vscode-panel-border);
  }
  .row-label { color: var(--vscode-descriptionForeground); }
  .row-value { text-align: right; word-break: break-word; }
  .ok { color: var(--vscode-testing-iconPassed, #3fb950); }
  .warn { color: var(--vscode-editorWarning-foreground); }
  .error { color: var(--vscode-errorForeground); }
  .muted { color: var(--vscode-descriptionForeground); }
  .actions { display: flex; flex-direction: column; gap: 6px; margin-top: 12px; }
  button {
    font-family: inherit;
    font-size: inherit;
    padding: 6px 10px;
    border: 1px solid var(--vscode-button-border, transparent);
    border-radius: 2px;
    background: var(--vscode-button-secondaryBackground, transparent);
    color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
    cursor: pointer;
    text-align: left;
  }
  button:hover { background: var(--vscode-button-secondaryHoverBackground, var(--vscode-toolbar-hoverBackground)); }
  button.primary {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
  }
  button.primary:hover { background: var(--vscode-button-hoverBackground); }
</style>
</head>
<body>
  <div class="rows">${rows.join("")}</div>
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
