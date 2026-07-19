# Engineering Memory for VS Code

A deliberately small popup-driven assistant for repository-specific review memory. The extension
keeps save-time validation quiet, then shows one aggregated warning popup when the repository's
pre-commit check blocks a commit.

## Simple UI

- One warning popup per blocked commit attempt.
- One popup action: **Review**.
- One status-bar item: clear, checking, warning count, no data, or unavailable.
- Warning diagnostics anchored to the matched added line.
- Two Quick Fix actions: **show evidence** and **mute this convention**.
- Evidence appears in one Output channel only when requested.
- No popup while typing or saving, or for clean results, missing data, low-confidence findings, or background errors.

## False-positive safeguards

Warnings are shown only when all of these pass:

1. repository, file path, and language scope;
2. deterministic prohibited-signal matching on Git-added lines;
3. minimum confidence (default `0.8`);
4. minimum distinct supporting PRs (default `2`);
5. convention is not muted;
6. duplicate convention/path/line findings are collapsed;
7. per-file diagnostic cap (default `5`).
8. duplicate filesystem events for one commit attempt are suppressed.

The extension checks on save after a 600 ms debounce but publishes only Problems diagnostics at that
stage. It does not scan every keystroke or diagnose unchanged legacy code. Untrusted workspaces are
not executed.

## Run in development

```bash
npm install
npm run db:setup
npm run api-server
npm run vscode:build
npm run hooks:install
```

Open the repository in VS Code, select **Run and Debug**, and launch **Engineering Memory Extension**.
The repository slug is inferred from `origin` unless explicitly configured. On first use, the
extension offers **Initialize Memory** and signs in through VS Code's built-in GitHub authentication.
The token is sent only as a bearer credential to the configured Engineering Memory GraphQL API,
which verifies repository access, backfills review history, and publishes conventions. Tokens remain
managed by VS Code and are never written to the workspace or extension settings. Set
`engineeringMemory.apiUrl` to an empty string only when testing the legacy local-JSON fallback.

Commands:

- `Engineering Memory: Validate Current File`
- `Engineering Memory: Validate Staged Changes`
- `Engineering Memory: Diagnose Current File` — explain configuration, diff detection, matching,
  and safeguard filtering in the Output channel.
- `Engineering Memory: Show Current Memory` — list the configured repository's compiled
  conventions, scopes, signals, confidence, and supporting PRs.
- `Engineering Memory: Initialize Repository Memory` — sign into GitHub and backfill/compile the
  current repository without CLI setup.

## Sidebar

The Engineering Memory icon in the Activity Bar opens a status panel that surfaces states that
otherwise only show up as a one-line status-bar string or buried Output-channel text: whether the
workspace is trusted, whether you're signed in to GitHub, the inferred repository, whether you're
talking to the hosted API or the local JSON fallback, and the compiled memory status. Each row that
needs an action gets a button next to it — **Trust Workspace…**, **Sign in to GitHub…**,
**Initialize Repository Memory** (becomes **Retry Setup** after a failed attempt), **Sync Now**
(ingest newly merged PRs immediately instead of waiting for the timer), **Show Current Memory**,
and **Open Output Log**. It updates itself whenever these things change — no manual refresh needed.

## Staying current automatically

After the first **Initialize Repository Memory**, the extension silently checks the current
repository for newly merged PRs on a timer (`engineeringMemory.autoIngestIntervalSeconds`,
default 300s; `0` disables it) and on workspace/folder changes — no manual re-run needed. This
never prompts a GitHub sign-in: it only uses a session VS Code already has, so a repository you
haven't explicitly initialized yet is left alone rather than nagging you on every tick.

Only newly merged PRs are fetched — `ingest()` skips anything already represented in local
memory, so a check where nothing has merged since the last one costs a single PR-list request.
When new comments *do* land, this step also compiles them into conventions immediately
(`ensureMemoryFresh`), rather than waiting for the next read — required for the Postgres-backed
store, which has no other automatic trigger that would ever turn freshly-ingested comments into
published conventions. When `engineeringMemory.apiUrl` is set (the default), this timer's
ingest-and-compile goes through the same hosted GraphQL API as everything else
(`requestRepositoryRefresh`), so it lands in the same store "Show Current Memory" and the dashboard
read from — not a separate local file.

## Popup behavior and limitations

VS Code notifications are transient, have limited room, are not anchored to a code line, and can be
dismissed or suppressed. They are also disruptive if emitted once per finding. The assistant
therefore emits one short aggregate popup only when the pre-commit hook rejects the staged diff and
all safeguards pass. **Review** opens the Problems panel and detailed evidence in the Output channel.
Diagnostics remain after the popup closes. Configure
`engineeringMemory.popupEnabled` or `engineeringMemory.popupCooldownSeconds` to change this behavior.
See VS Code's [notification UX guidance](https://code.visualstudio.com/api/ux-guidelines/notifications).

The popup requires VS Code to be open with this extension active. A terminal-only commit is still
blocked and prints the same evidence, but cannot display a VS Code notification. Like every local Git
hook, the gate can be bypassed with `git commit --no-verify`; enforce the same check in CI for production.

## Current limitations

- The API verifies GitHub repository access but does not yet issue its own short-lived application session.
- Requires Git and a repository `origin` unless configured manually.
- Deterministic imports/calls/signals only; subjective conventions need AST or semantic validation.
- A new untracked file is treated as entirely added.
- Personal “you received this feedback before” messaging is unavailable until ingestion records the
  PR author separately from the reviewer.
- Development build only; marketplace packaging/signing is not configured.
