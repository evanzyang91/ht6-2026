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

## Staying current automatically

After the first **Initialize Repository Memory**, the extension silently checks the current
repository for newly merged PRs on a timer (`engineeringMemory.autoIngestIntervalSeconds`,
default 300s; `0` disables it) and on workspace/folder changes — no manual re-run needed. This
never prompts a GitHub sign-in: it only uses a session VS Code already has, so a repository you
haven't explicitly initialized yet is left alone rather than nagging you on every tick.

Only newly merged PRs are fetched — `ingest()` skips anything already represented in local
memory, so a check where nothing has merged since the last one costs a single PR-list request,
not a re-scrape of history. This step deliberately does **not** compile conventions immediately;
that still happens lazily, the next time memory is actually read (a file save, "Show Current
Memory," etc.) — same lazy-extraction design the GitHub webhook path uses for teams running a
shared server instead of (or alongside) this extension.

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
