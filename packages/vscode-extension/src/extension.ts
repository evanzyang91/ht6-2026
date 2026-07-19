import * as vscode from "vscode";
import { isAbsolute, join, resolve } from "node:path";
import type {
  EngineeringMemorySnapshot,
  MemoryInitializationResult,
  PredictedFeedback,
  RepositoryMemoryInspection,
} from "@ht6/mcp-server/api" with { "resolution-mode": "import" };
import { applySafeguards, diagnoseSafeguards, type SafeguardSettings } from "./safeguards.js";
import { diffForFile, repositoryForWorkspace, stagedDiff } from "./git.js";
import { shouldShowPopup, type PopupRecord } from "./popupPolicy.js";
import { EngineeringMemoryGraphqlClient } from "./graphqlClient.js";
import type { SidebarSnapshot } from "./sidebarView.js";
import { EngineeringMemorySidebarProvider } from "./sidebarViewProvider.js";

const SOURCE = "Engineering Memory";

interface CommitReviewNotification {
  repository: string;
  createdAt: string;
  findings: PredictedFeedback[];
}

async function validateMemory(repository: string, diff: string, dataDirectory: string, apiUrl: string, token?: string) {
  if (apiUrl) return new EngineeringMemoryGraphqlClient(apiUrl, requiredToken(token)).validate(repository, diff);
  const { validateRepositoryDiff } = await import("@ht6/mcp-server/api");
  return validateRepositoryDiff(repository, diff, { dataDirectory });
}

async function loadMemory(repository: string, dataDirectory: string, apiUrl: string, token?: string): Promise<EngineeringMemorySnapshot> {
  if (apiUrl) return new EngineeringMemoryGraphqlClient(apiUrl, requiredToken(token)).memory(repository);
  const { loadRepositoryMemory } = await import("@ht6/mcp-server/api");
  return loadRepositoryMemory(repository, { dataDirectory });
}

async function inspectMemory(repository: string, dataDirectory: string, apiUrl: string, token?: string): Promise<RepositoryMemoryInspection> {
  if (apiUrl) return new EngineeringMemoryGraphqlClient(apiUrl, requiredToken(token)).inspect(repository);
  const { inspectRepositoryMemory } = await import("@ht6/mcp-server/api");
  return inspectRepositoryMemory(repository, { dataDirectory });
}

async function initializeMemory(
  repository: string,
  token: string,
  dataDirectory: string,
  limit: number,
  onProgress: (message: string) => void,
  apiUrl: string,
): Promise<MemoryInitializationResult> {
  if (apiUrl) {
    onProgress("Requesting repository sync…");
    return new EngineeringMemoryGraphqlClient(apiUrl, token).sync(repository, limit);
  }
  const { initializeRepositoryMemory } = await import("@ht6/mcp-server/api");
  return initializeRepositoryMemory(repository, {
    token,
    dataDirectory,
    limit,
    onProgress: (progress) => onProgress(progress.message),
  });
}

// Unlike initializeMemory, this does not run extraction — it only ingests newly merged PRs and
// leaves compiling that into conventions for the next read (loadMemory/validateMemory), which
// runs ensureMemoryFresh lazily. Used by the background auto-ingest poll, which should never
// force a full extraction pass just because its timer fired. Mirrors the apiUrl branch the other
// three helpers already have, so this also lands in the hosted API's store (not just the local
// JSON fallback) when engineeringMemory.apiUrl is configured.
async function refreshMemory(
  repository: string,
  token: string,
  dataDirectory: string,
  limit: number,
  apiUrl: string,
): Promise<{ commentCount: number }> {
  if (apiUrl) return new EngineeringMemoryGraphqlClient(apiUrl, token).refresh(repository, limit);
  const { refreshRepositoryMemory } = await import("@ht6/mcp-server/api");
  return refreshRepositoryMemory(repository, { token, dataDirectory, limit });
}

interface WorkspaceContext {
  root: string;
  repository: string;
  dataDirectory: string;
  apiUrl: string;
}

function requiredToken(token: string | undefined): string {
  if (!token) throw new Error("Sign in to GitHub with Engineering Memory before using the hosted API");
  return token;
}

class MemoryController implements vscode.Disposable {
  private readonly diagnostics = vscode.languages.createDiagnosticCollection("engineering-memory");
  private readonly output = vscode.window.createOutputChannel(SOURCE);
  private readonly status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly findings = new Map<string, PredictedFeedback>();
  private readonly popupHistory = new Map<string, PopupRecord>();
  private readonly initializationPrompts = new Set<string>();
  private commitWatchers: vscode.Disposable[] = [];
  private autoIngestTimer: NodeJS.Timeout | undefined;
  private autoIngestRunning = false;
  private manualSyncRunning = false;
  private readonly refreshes = new Map<string, Promise<{ commentCount: number }>>();
  private lastSyncAt: number | undefined;
  private lastSyncCommentCount: number | undefined;
  private readonly statusEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeStatus = this.statusEmitter.event;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.status.command = "engineeringMemory.validateStagedChanges";
    this.status.text = "$(shield) Memory";
    this.status.tooltip = "Validate staged changes with Engineering Memory";
    this.status.show();
    this.setupCommitWatchers();
    context.subscriptions.push(
      this,
      this.diagnostics,
      this.output,
      this.status,
      this.statusEmitter,
      vscode.workspace.onDidSaveTextDocument((document) => this.scheduleDocument(document)),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("engineeringMemory.dataDirectory")) this.setupCommitWatchers();
        if (event.affectsConfiguration("engineeringMemory")) {
          void this.validateCurrentFile();
          void this.checkRepositoryInitialization();
        }
        if (event.affectsConfiguration("engineeringMemory.autoIngestIntervalSeconds")) this.scheduleAutoIngest();
      }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        this.setupCommitWatchers();
        void this.checkRepositoryInitialization();
        void this.autoIngestCurrentRepository();
      }),
      vscode.commands.registerCommand("engineeringMemory.validateCurrentFile", () => this.validateCurrentFile()),
      vscode.commands.registerCommand("engineeringMemory.validateStagedChanges", () => this.validateStagedChanges()),
      vscode.commands.registerCommand("engineeringMemory.diagnoseCurrentFile", () => this.diagnoseCurrentFile()),
      vscode.commands.registerCommand("engineeringMemory.showCurrentMemory", () => this.showCurrentMemory()),
      vscode.commands.registerCommand("engineeringMemory.initializeRepository", () => this.initializeRepository()),
      vscode.commands.registerCommand("engineeringMemory.showEvidence", (finding: PredictedFeedback) => this.showEvidence(finding)),
      vscode.commands.registerCommand("engineeringMemory.muteConvention", (finding: PredictedFeedback) => this.muteConvention(finding)),
      vscode.languages.registerCodeActionsProvider({ scheme: "file" }, {
        provideCodeActions: (_document, _range, context) => this.codeActions(context.diagnostics),
      }, { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }),
    );
    void this.checkRepositoryInitialization();
    this.scheduleAutoIngest();
  }

  dispose(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    if (this.autoIngestTimer) clearInterval(this.autoIngestTimer);
    for (const watcher of this.commitWatchers) watcher.dispose();
    this.commitWatchers = [];
  }

  private configuration(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration("engineeringMemory");
  }

  private safeguardSettings(): SafeguardSettings {
    const configuration = this.configuration();
    return {
      minimumConfidence: configuration.get("minimumConfidence", 0.5),
      minimumPullRequestSupport: configuration.get("minimumPullRequestSupport", 1),
      maximumDiagnosticsPerFile: configuration.get("maximumDiagnosticsPerFile", 5),
      mutedConventionIds: configuration.get<string[]>("mutedConventionIds", []),
    };
  }

  private scheduleDocument(document: vscode.TextDocument): void {
    if (!this.configuration().get("enabled", true) || document.uri.scheme !== "file") return;
    const key = document.uri.toString();
    const existing = this.timers.get(key);
    if (existing) clearTimeout(existing);
    this.timers.set(key, setTimeout(() => {
      this.timers.delete(key);
      void this.validateDocument(document);
    }, 600));
  }

  async validateCurrentFile(): Promise<void> {
    const document = vscode.window.activeTextEditor?.document;
    if (document) await this.validateDocument(document);
  }

  private async contextForDocument(document: vscode.TextDocument): Promise<WorkspaceContext | undefined> {
    if (!vscode.workspace.isTrusted || document.uri.scheme !== "file") return undefined;
    const folder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (!folder) return undefined;
    return this.contextForFolder(folder);
  }

  private async contextForFolder(folder: vscode.WorkspaceFolder): Promise<WorkspaceContext> {
    const root = folder.uri.fsPath;
    const configuredRepository = this.configuration().get<string>("repository", "").trim();
    const repository = configuredRepository || await repositoryForWorkspace(root);
    if (!repository) throw new Error("Cannot infer owner/repository from the origin remote");
    const configuredData = this.configuration().get<string>("dataDirectory", "").trim();
    const dataDirectory = configuredData
      ? (isAbsolute(configuredData) ? configuredData : resolve(root, configuredData))
      : this.context.globalStorageUri.fsPath;
    const apiUrl = this.configuration().get<string>("apiUrl", "").trim();
    return { root, repository, dataDirectory, apiUrl };
  }

  private async githubToken(createIfNone: boolean): Promise<string | undefined> {
    const session = await vscode.authentication.getSession("github", ["repo"], createIfNone
      ? { createIfNone: { detail: "Engineering Memory needs access to repository review history." } }
      : { createIfNone: false });
    return session?.accessToken;
  }

  private async checkRepositoryInitialization(): Promise<void> {
    const folder = this.commandFolder();
    if (!folder || !vscode.workspace.isTrusted) return;
    try {
      const context = await this.contextForFolder(folder);
      const token = context.apiUrl ? await this.githubToken(false) : undefined;
      const inspection = context.apiUrl && !token
        ? { repository: context.repository, status: "unprocessed" as const, conventionCount: 0 }
        : await inspectMemory(context.repository, context.dataDirectory, context.apiUrl, token);
      if (inspection.status === "ready") {
        this.status.text = `$(shield) Memory: ${inspection.conventionCount} conventions`;
        this.status.command = "engineeringMemory.showCurrentMemory";
        return;
      }
      if (inspection.status === "stale") {
        this.status.text = "$(sync~spin) Memory refreshing";
        await loadMemory(context.repository, context.dataDirectory, context.apiUrl, token);
        await this.checkRepositoryInitialization();
        return;
      }
      if (inspection.status === "empty") {
        this.status.text = "$(shield) Memory: processed, no conventions";
        this.status.command = "engineeringMemory.showCurrentMemory";
        return;
      }

      this.status.text = inspection.status === "failed"
        ? "$(error) Memory setup failed"
        : "$(cloud-download) Memory: set up";
      this.status.command = "engineeringMemory.initializeRepository";
      if (this.initializationPrompts.has(context.repository)) return;
      this.initializationPrompts.add(context.repository);
      const message = inspection.status === "failed"
        ? `Engineering Memory could not initialize ${context.repository}. Retry GitHub setup?`
        : `Engineering Memory has not indexed ${context.repository} yet.`;
      const selected = await vscode.window.showInformationMessage(
        message,
        inspection.status === "failed" ? "Retry" : "Initialize Memory",
        "Not Now",
      );
      if (selected === "Initialize Memory" || selected === "Retry") await this.initializeRepository();
    } catch (error) {
      this.status.text = "$(cloud-download) Memory: setup needed";
      this.status.command = "engineeringMemory.initializeRepository";
      this.output.appendLine(`[${new Date().toISOString()}] Setup detection: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.statusEmitter.fire();
    }
  }

  async initializeRepository(): Promise<void> {
    const folder = this.commandFolder();
    if (!folder || !vscode.workspace.isTrusted) {
      await vscode.window.showInformationMessage("Open and trust a Git repository before initializing Engineering Memory.");
      return;
    }
    try {
      const context = await this.contextForFolder(folder);
      const session = await vscode.authentication.getSession("github", ["repo"], {
        createIfNone: {
          detail: `Engineering Memory needs read access to review history for ${context.repository}.`,
        },
      });
      const limit = this.configuration().get("historyLimit", 75);
      this.status.text = "$(sync~spin) Memory initializing";
      const result = await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `Initializing Engineering Memory for ${context.repository}`,
        cancellable: false,
      }, async (progress) => initializeMemory(
        context.repository,
        session.accessToken,
        context.dataDirectory,
        limit,
        (message) => progress.report({ message }),
        context.apiUrl,
      ));
      this.status.text = result.conventionCount
        ? `$(shield) Memory: ${result.conventionCount} conventions`
        : "$(shield) Memory: processed, no conventions";
      this.status.command = "engineeringMemory.showCurrentMemory";
      const selected = await vscode.window.showInformationMessage(
        result.conventionCount
          ? `Engineering Memory learned ${result.conventionCount} conventions from ${result.commentCount} review comments.`
          : `Engineering Memory processed ${result.commentCount} review comments but found no repeated conventions yet.`,
        "Show Memory",
      );
      if (selected === "Show Memory") await this.showCurrentMemory();
    } catch (error) {
      this.reportError(error);
      this.status.text = "$(error) Memory setup failed";
      this.status.command = "engineeringMemory.initializeRepository";
      const selected = await vscode.window.showErrorMessage(
        `Engineering Memory setup failed: ${error instanceof Error ? error.message : String(error)}`,
        "View Details",
      );
      if (selected === "View Details") this.output.show(true);
    } finally {
      this.statusEmitter.fire();
    }
  }

  private scheduleAutoIngest(): void {
    if (this.autoIngestTimer) clearInterval(this.autoIngestTimer);
    const seconds = this.configuration().get("autoIngestIntervalSeconds", 300);
    if (!seconds) return;
    this.autoIngestTimer = setInterval(() => void this.autoIngestCurrentRepository(), seconds * 1000);
    void this.autoIngestCurrentRepository();
  }

  /**
   * Silently checks the current repository for newly merged PRs, ingests just those, and compiles
   * them into conventions if anything new landed (see refreshRepositoryMemory in
   * @ht6/mcp-server/api, which now runs ensureMemoryFresh right after ingesting — required because
   * the Postgres-backed store has no other trigger that would ever compile freshly-ingested
   * comments into published conventions). ingest() already skips PRs already represented in the
   * store, and ensureMemoryFresh is a no-op when nothing changed, so a tick where nothing merged
   * still costs only one PR-list request, not a wasted extraction pass.
   * Never prompts a GitHub login: only an already-established session is used
   * (createIfNone: false, silent: true), so a repository nobody has explicitly initialized yet
   * is silently left alone rather than nagging the user on a timer.
   */
  private async autoIngestCurrentRepository(): Promise<void> {
    if (this.autoIngestRunning) return;
    const folder = this.commandFolder();
    if (!folder || !vscode.workspace.isTrusted) return;
    this.autoIngestRunning = true;
    try {
      const context = await this.contextForFolder(folder);
      const session = await vscode.authentication.getSession("github", ["repo"], {
        createIfNone: false,
        silent: true,
      });
      if (!session) return;
      await this.runRefresh(context, session);
    } catch (error) {
      this.output.appendLine(`[${new Date().toISOString()}] Auto-refresh: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.autoIngestRunning = false;
      this.statusEmitter.fire();
    }
  }

  /** Explicit "Sync Now" action for the sidebar — unlike the silent timer, this may prompt a GitHub sign-in. */
  async syncNow(): Promise<void> {
    // Webview messages can arrive more than once before its HTML is refreshed. Treat repeated
    // clicks as one operation so they cannot start overlapping API mutations and status refreshes.
    if (this.manualSyncRunning) return;
    this.manualSyncRunning = true;
    const folder = this.commandFolder();
    if (!folder || !vscode.workspace.isTrusted) {
      await vscode.window.showInformationMessage("Open and trust a Git repository before syncing Engineering Memory.");
      this.manualSyncRunning = false;
      return;
    }
    try {
      const context = await this.contextForFolder(folder);
      const session = await vscode.authentication.getSession("github", ["repo"], {
        createIfNone: { detail: `Engineering Memory needs read access to review history for ${context.repository}.` },
      });
      await this.runRefresh(context, session);
    } catch (error) {
      this.reportError(error);
    } finally {
      this.manualSyncRunning = false;
      this.statusEmitter.fire();
    }
  }

  private async runRefresh(context: WorkspaceContext, session: vscode.AuthenticationSession): Promise<void> {
    const limit = this.configuration().get("historyLimit", 75);
    let refresh = this.refreshes.get(context.repository);
    if (!refresh) {
      refresh = refreshMemory(
        context.repository,
        session.accessToken,
        context.dataDirectory,
        limit,
        context.apiUrl,
      );
      this.refreshes.set(context.repository, refresh);
    }
    let result: { commentCount: number };
    try {
      result = await refresh;
    } finally {
      if (this.refreshes.get(context.repository) === refresh) this.refreshes.delete(context.repository);
    }
    this.lastSyncAt = Date.now();
    this.lastSyncCommentCount = result.commentCount;
    this.output.appendLine(
      `[${new Date().toISOString()}] Auto-refresh: ${context.repository} now has ${result.commentCount} stored comments.`
    );
  }

  /** Prompts a GitHub sign-in, e.g. from the sidebar's "Sign in to GitHub" button. */
  async signInToGitHub(): Promise<void> {
    try {
      await this.githubToken(true);
    } finally {
      this.statusEmitter.fire();
    }
  }

  /** Read-only status snapshot for the sidebar webview — never triggers ingestion or extraction. */
  async getSidebarSnapshot(): Promise<SidebarSnapshot> {
    const apiUrl = this.configuration().get<string>("apiUrl", "").trim();
    const folder = this.commandFolder();
    const trusted = vscode.workspace.isTrusted;
    const snapshot: SidebarSnapshot = {
      hasFolder: Boolean(folder),
      trusted,
      signedIn: false,
      apiUrl,
      lastSyncAt: this.lastSyncAt,
      lastSyncCommentCount: this.lastSyncCommentCount,
    };
    if (!folder || !trusted) return snapshot;
    snapshot.signedIn = Boolean(await this.githubToken(false));
    let context: WorkspaceContext | undefined;
    try {
      context = await this.contextForFolder(folder);
      snapshot.repository = context.repository;
    } catch (error) {
      snapshot.repositoryError = error instanceof Error ? error.message : String(error);
      return snapshot;
    }
    try {
      const token = apiUrl ? await this.githubToken(false) : undefined;
      const inspection = apiUrl && !token
        ? { repository: context.repository, status: "unprocessed" as const, conventionCount: 0 }
        : await inspectMemory(context.repository, context.dataDirectory, apiUrl, token);
      snapshot.status = inspection.status;
      snapshot.conventionCount = inspection.conventionCount;
      snapshot.lastError = inspection.lastError;
    } catch (error) {
      snapshot.statusError = error instanceof Error ? error.message : String(error);
    }
    return snapshot;
  }

  private commandFolder(): vscode.WorkspaceFolder | undefined {
    const document = vscode.window.activeTextEditor?.document;
    // Output/log editors can temporarily become active while a command is running. They are not
    // in a workspace, so fall back to the open workspace instead of rendering "No folder open".
    return (document ? vscode.workspace.getWorkspaceFolder(document.uri) : undefined)
      ?? vscode.workspace.workspaceFolders?.[0];
  }

  private async validateDocument(document: vscode.TextDocument): Promise<void> {
    if (!this.configuration().get("enabled", true)) {
      this.diagnostics.delete(document.uri);
      return;
    }
    try {
      const context = await this.contextForDocument(document);
      if (!context) {
        this.status.text = "$(shield) Memory paused";
        return;
      }
      const diff = await diffForFile(context.root, document.uri.fsPath, document.getText());
      if (!diff.trim()) {
        this.diagnostics.delete(document.uri);
        this.status.text = "$(shield-check) Memory clear";
        return;
      }
      this.status.text = "$(sync~spin) Memory checking";
      const result = await validateMemory(context.repository, diff, context.dataDirectory, context.apiUrl, await this.githubToken(false));
      if (!result.conventionCount) {
        this.diagnostics.delete(document.uri);
        this.status.text = "$(shield) Memory: no data";
        return;
      }
      const filtered = applySafeguards(result.findings, this.safeguardSettings())
        .filter((finding) => finding.matchedPath === diffPath(context.root, document.uri.fsPath));
      this.publish(document.uri, filtered, document);
      this.status.text = filtered.length ? `$(warning) Memory ${filtered.length}` : "$(shield-check) Memory clear";
    } catch (error) {
      this.reportError(error);
    }
  }

  async validateStagedChanges(): Promise<void> {
    const folder = vscode.window.activeTextEditor
      ? vscode.workspace.getWorkspaceFolder(vscode.window.activeTextEditor.document.uri)
      : vscode.workspace.workspaceFolders?.[0];
    if (!folder || !vscode.workspace.isTrusted) return;
    try {
      const root = folder.uri.fsPath;
      const repository = this.configuration().get<string>("repository", "").trim() || await repositoryForWorkspace(root);
      if (!repository) throw new Error("Cannot infer owner/repository from the origin remote");
      const configuredData = this.configuration().get<string>("dataDirectory", "").trim();
      const dataDirectory = configuredData ? (isAbsolute(configuredData) ? configuredData : resolve(root, configuredData)) : join(root, "data");
      const apiUrl = this.configuration().get<string>("apiUrl", "").trim();
      const diff = await stagedDiff(root);
      if (!diff.trim()) {
        this.status.text = "$(shield-check) Memory: nothing staged";
        return;
      }
      this.status.text = "$(sync~spin) Memory checking";
      const result = await validateMemory(repository, diff, dataDirectory, apiUrl, await this.githubToken(false));
      const filtered = applySafeguards(result.findings, this.safeguardSettings());
      this.diagnostics.clear();
      const grouped = new Map<string, PredictedFeedback[]>();
      for (const finding of filtered) grouped.set(finding.matchedPath, [...(grouped.get(finding.matchedPath) ?? []), finding]);
      for (const [path, findings] of grouped) this.publish(vscode.Uri.joinPath(folder.uri, path), findings);
      this.status.text = filtered.length ? `$(warning) Memory ${filtered.length}` : "$(shield-check) Memory clear";
    } catch (error) {
      this.reportError(error);
    }
  }

  async diagnoseCurrentFile(): Promise<void> {
    const document = vscode.window.activeTextEditor?.document;
    if (!document) {
      await vscode.window.showInformationMessage("Open a file to diagnose Engineering Memory validation.");
      return;
    }
    this.output.clear();
    this.output.appendLine("Engineering Memory — current file diagnosis");
    this.output.appendLine("============================================");
    try {
      const context = await this.contextForDocument(document);
      if (!context) {
        this.output.appendLine(`Workspace trusted: ${vscode.workspace.isTrusted ? "yes" : "no"}`);
        this.output.appendLine("Validation unavailable: the file is not in a trusted file workspace.");
        this.output.show(true);
        return;
      }
      const diff = await diffForFile(context.root, document.uri.fsPath, document.getText());
      const result = await validateMemory(context.repository, diff, context.dataDirectory, context.apiUrl, await this.githubToken(false));
      const settings = this.safeguardSettings();
      const safeguardResult = diagnoseSafeguards(result.findings, settings);
      const path = diffPath(context.root, document.uri.fsPath);
      const eligibleForFile = safeguardResult.findings.filter((finding) => finding.matchedPath === path);

      this.output.appendLine(`Extension active: yes`);
      this.output.appendLine(`Workspace trusted: yes`);
      this.output.appendLine(`Repository: ${context.repository}`);
      this.output.appendLine(`Data directory: ${context.dataDirectory}`);
      this.output.appendLine(`API endpoint: ${context.apiUrl || "local JSON"}`);
      this.output.appendLine(`File: ${path}`);
      this.output.appendLine(`Git diff detected: ${diff.trim() ? "yes" : "no"}`);
      this.output.appendLine(`Added lines inspected: ${countAddedLines(diff)}`);
      this.output.appendLine(`Compiled repository conventions: ${result.conventionCount}`);
      this.output.appendLine(`Deterministic scope/signal matches: ${result.findings.length}`);
      this.output.appendLine(`Eligible warnings for this file: ${eligibleForFile.length}`);
      this.output.appendLine("");
      this.output.appendLine("Safeguard filtering");
      this.output.appendLine(`  Below confidence ${settings.minimumConfidence}: ${safeguardResult.diagnostics.belowConfidence}`);
      this.output.appendLine(`  Below ${settings.minimumPullRequestSupport}-PR support: ${safeguardResult.diagnostics.insufficientSupport}`);
      this.output.appendLine(`  Muted: ${safeguardResult.diagnostics.muted}`);
      this.output.appendLine(`  Duplicate: ${safeguardResult.diagnostics.duplicates}`);
      this.output.appendLine(`  Over per-file cap: ${safeguardResult.diagnostics.overFileLimit}`);

      if (result.findings.length) {
        this.output.appendLine("");
        this.output.appendLine("Raw deterministic matches");
        for (const finding of result.findings) {
          this.output.appendLine(`  - ${finding.matchedPath}:${finding.matchedLine ?? "?"} — ${finding.rule}`);
          this.output.appendLine(`    Signal: ${finding.matchedSignal}; confidence: ${finding.confidence}; support: ${finding.supportCount} PRs`);
        }
      } else {
        this.output.appendLine("");
        this.output.appendLine(result.conventionCount
          ? "No changed line matched a stored convention's path, language, and prohibited signal."
          : "No conventions were loaded for the configured repository.");
      }
      this.status.text = eligibleForFile.length
        ? `$(warning) Memory ${eligibleForFile.length}`
        : "$(shield-check) Memory diagnosed";
      this.output.show(true);
    } catch (error) {
      this.reportError(error);
      this.output.show(true);
    }
  }

  async showCurrentMemory(): Promise<void> {
    const folder = this.commandFolder();
    if (!folder || !vscode.workspace.isTrusted) {
      await vscode.window.showInformationMessage("Open and trust a workspace to inspect Engineering Memory.");
      return;
    }
    this.output.clear();
    this.output.appendLine("Engineering Memory — current repository memory");
    this.output.appendLine("==============================================");
    try {
      const context = await this.contextForFolder(folder);
      const snapshot = await loadMemory(context.repository, context.dataDirectory, context.apiUrl, await this.githubToken(false));
      const conventions = [...snapshot.conventions].sort(
        (left, right) => right.confidence - left.confidence || right.supportingEpisodes.length - left.supportingEpisodes.length
      );
      this.output.appendLine(`Repository: ${snapshot.repository}`);
      this.output.appendLine(`Data directory: ${context.dataDirectory}`);
      this.output.appendLine(`API endpoint: ${context.apiUrl || "local JSON"}`);
      this.output.appendLine(`Conventions loaded: ${conventions.length}`);
      if (!conventions.length) {
        this.output.appendLine("");
        this.output.appendLine("No compiled conventions exist for this repository.");
      }
      conventions.forEach((convention, index) => {
        const pullRequests = [...new Set(convention.evidence.map((item) => item.pullRequest))];
        this.output.appendLine("");
        this.output.appendLine(`${index + 1}. ${convention.title}`);
        this.output.appendLine(`   Rule: ${convention.rule}`);
        this.output.appendLine(`   Category: ${convention.category}`);
        this.output.appendLine(`   Confidence: ${Math.round(convention.confidence * 100)}%`);
        this.output.appendLine(`   Scope: ${convention.pathScopes.join(", ") || "all paths"}`);
        this.output.appendLine(`   Languages: ${convention.languages.join(", ") || "all"}`);
        this.output.appendLine(`   Prohibited signals: ${convention.prohibitedSignals.join(", ") || "none (semantic only)"}`);
        this.output.appendLine(`   Preferred signals: ${convention.preferredSignals.join(", ") || "none"}`);
        this.output.appendLine(`   Supporting PRs: ${pullRequests.map((number) => `#${number}`).join(", ") || "none"}`);
      });
      this.status.text = conventions.length
        ? `$(shield) Memory: ${conventions.length} conventions`
        : "$(shield) Memory: no data";
      this.output.show(true);
    } catch (error) {
      this.reportError(error);
      this.output.show(true);
    }
  }

  private publish(uri: vscode.Uri, values: PredictedFeedback[], document?: vscode.TextDocument): void {
    const diagnostics = values.map((finding) => {
      this.findings.set(finding.conventionId, finding);
      const line = Math.max(0, (finding.matchedLine ?? 1) - 1);
      const lineLength = document && line < document.lineCount ? document.lineAt(line).text.length : 1000;
      const diagnostic = new vscode.Diagnostic(
        new vscode.Range(line, 0, line, Math.max(1, lineLength)),
        `${finding.rule} (${Math.round(finding.confidence * 100)}% confidence, ${finding.supportCount} supporting PRs)`,
        vscode.DiagnosticSeverity.Warning,
      );
      diagnostic.source = SOURCE;
      diagnostic.code = finding.conventionId;
      return diagnostic;
    });
    this.diagnostics.set(uri, diagnostics);
  }

  private codeActions(diagnostics: readonly vscode.Diagnostic[]): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];
    for (const diagnostic of diagnostics.filter((item) => item.source === SOURCE)) {
      const finding = this.findings.get(String(diagnostic.code));
      if (!finding) continue;
      const explain = new vscode.CodeAction("Engineering Memory: show evidence", vscode.CodeActionKind.QuickFix);
      explain.command = { command: "engineeringMemory.showEvidence", title: "Show evidence", arguments: [finding] };
      explain.diagnostics = [diagnostic];
      const mute = new vscode.CodeAction("Engineering Memory: mute this convention", vscode.CodeActionKind.QuickFix);
      mute.command = { command: "engineeringMemory.muteConvention", title: "Mute convention", arguments: [finding] };
      mute.diagnostics = [diagnostic];
      actions.push(explain, mute);
    }
    return actions;
  }

  private showEvidence(finding: PredictedFeedback): void {
    this.output.clear();
    this.output.appendLine(finding.rule);
    this.output.appendLine(`Confidence: ${Math.round(finding.confidence * 100)}%`);
    this.output.appendLine(`Path: ${finding.matchedPath}${finding.matchedLine ? `:${finding.matchedLine}` : ""}`);
    this.output.appendLine(`Reason: ${finding.reason}`);
    this.output.appendLine(`Supporting PRs: ${finding.supportingPRs.map((number) => `#${number}`).join(", ") || "none"}`);
    if (finding.acceptedExamples[0]) this.output.appendLine(`\nAccepted example:\n${finding.acceptedExamples[0]}`);
    this.output.show(true);
  }

  private setupCommitWatchers(): void {
    for (const disposable of this.commitWatchers) disposable.dispose();
    this.commitWatchers = [];
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const configuredData = this.configuration().get<string>("dataDirectory", "").trim();
      const memoryDirectory = configuredData
        ? (isAbsolute(configuredData) ? configuredData : resolve(folder.uri.fsPath, configuredData))
        : this.context.globalStorageUri.fsPath;
      const directories = new Set([memoryDirectory, join(folder.uri.fsPath, "data")]);
      for (const dataDirectory of directories) {
        const watcher = vscode.workspace.createFileSystemWatcher(
          new vscode.RelativePattern(dataDirectory, "commit-review.json"),
        );
        this.commitWatchers.push(
          watcher,
          watcher.onDidCreate((uri) => void this.handleCommitReview(uri, folder)),
          watcher.onDidChange((uri) => void this.handleCommitReview(uri, folder)),
        );
      }
    }
  }

  private async handleCommitReview(uri: vscode.Uri, folder: vscode.WorkspaceFolder): Promise<void> {
    if (!vscode.workspace.isTrusted || !this.configuration().get("enabled", true)) return;
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      const notification = JSON.parse(Buffer.from(bytes).toString("utf8")) as CommitReviewNotification;
      if (!notification.createdAt || !Array.isArray(notification.findings)) return;
      const filtered = applySafeguards(notification.findings, this.safeguardSettings());
      if (!filtered.length) return;
      this.diagnostics.clear();
      const grouped = new Map<string, PredictedFeedback[]>();
      for (const finding of filtered) {
        grouped.set(finding.matchedPath, [...(grouped.get(finding.matchedPath) ?? []), finding]);
      }
      for (const [path, findings] of grouped) this.publish(vscode.Uri.joinPath(folder.uri, path), findings);
      this.status.text = `$(error) Commit blocked (${filtered.length})`;
      await this.notifyCommitFindings(`commit:${notification.createdAt}`, filtered);
    } catch (error) {
      this.reportError(error);
    }
  }

  private async notifyCommitFindings(scope: string, findings: PredictedFeedback[]): Promise<void> {
    const configuration = this.configuration();
    if (!configuration.get("popupEnabled", true)) return;
    const cooldown = configuration.get("popupCooldownSeconds", 300) * 1000;
    const decision = shouldShowPopup(findings, this.popupHistory.get(scope), Date.now(), cooldown);
    if (!decision.show || !decision.record) return;
    this.popupHistory.set(scope, decision.record);
    const top = findings[0];
    const compactRule = top.rule.length > 120 ? `${top.rule.slice(0, 117)}...` : top.rule;
    const message = findings.length === 1
      ? `Commit blocked: ${compactRule}`
      : `Commit blocked: Engineering Memory found ${findings.length} potential review blockers.`;
    const selected = await vscode.window.showWarningMessage(message, "Review");
    if (selected === "Review") {
      this.showEvidence(top);
      await vscode.commands.executeCommand("workbench.actions.view.problems");
    }
  }

  private async muteConvention(finding: PredictedFeedback): Promise<void> {
    const configuration = this.configuration();
    const muted = new Set(configuration.get<string[]>("mutedConventionIds", []));
    muted.add(finding.conventionId);
    await configuration.update("mutedConventionIds", [...muted], vscode.ConfigurationTarget.Workspace);
    this.diagnostics.forEach((uri, diagnostics) => {
      this.diagnostics.set(uri, diagnostics.filter((diagnostic) => String(diagnostic.code) !== finding.conventionId));
    });
  }

  private reportError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.status.text = "$(shield) Memory unavailable";
    this.output.appendLine(`[${new Date().toISOString()}] ${message}`);
  }
}

function diffPath(root: string, absolutePath: string): string {
  return absolutePath.slice(root.length + 1).replaceAll("\\", "/");
}

function countAddedLines(diff: string): number {
  return diff.split("\n").filter((line) => line.startsWith("+") && !line.startsWith("+++")).length;
}

export function activate(context: vscode.ExtensionContext): void {
  const controller = new MemoryController(context);
  const sidebarProvider = new EngineeringMemorySidebarProvider(controller);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("engineeringMemory.sidebar", sidebarProvider),
  );
}

export function deactivate(): void {}
