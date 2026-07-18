import * as vscode from "vscode";
import { isAbsolute, join, resolve } from "node:path";
import type { PredictedFeedback } from "@ht6/mcp-server/api" with { "resolution-mode": "import" };
import { applySafeguards, type SafeguardSettings } from "./safeguards.js";
import { diffForFile, repositoryForWorkspace, stagedDiff } from "./git.js";
import { shouldShowPopup, type PopupRecord } from "./popupPolicy.js";

const SOURCE = "Engineering Memory";

interface CommitReviewNotification {
  repository: string;
  createdAt: string;
  findings: PredictedFeedback[];
}

async function validateMemory(repository: string, diff: string, dataDirectory: string) {
  const { validateRepositoryDiff } = await import("@ht6/mcp-server/api");
  return validateRepositoryDiff(repository, diff, { dataDirectory });
}

class MemoryController implements vscode.Disposable {
  private readonly diagnostics = vscode.languages.createDiagnosticCollection("engineering-memory");
  private readonly output = vscode.window.createOutputChannel(SOURCE);
  private readonly status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly findings = new Map<string, PredictedFeedback>();
  private readonly popupHistory = new Map<string, PopupRecord>();
  private commitWatchers: vscode.Disposable[] = [];

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
      vscode.workspace.onDidSaveTextDocument((document) => this.scheduleDocument(document)),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("engineeringMemory.dataDirectory")) this.setupCommitWatchers();
        if (event.affectsConfiguration("engineeringMemory")) void this.validateCurrentFile();
      }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.setupCommitWatchers()),
      vscode.commands.registerCommand("engineeringMemory.validateCurrentFile", () => this.validateCurrentFile()),
      vscode.commands.registerCommand("engineeringMemory.validateStagedChanges", () => this.validateStagedChanges()),
      vscode.commands.registerCommand("engineeringMemory.showEvidence", (finding: PredictedFeedback) => this.showEvidence(finding)),
      vscode.commands.registerCommand("engineeringMemory.muteConvention", (finding: PredictedFeedback) => this.muteConvention(finding)),
      vscode.languages.registerCodeActionsProvider({ scheme: "file" }, {
        provideCodeActions: (_document, _range, context) => this.codeActions(context.diagnostics),
      }, { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }),
    );
  }

  dispose(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    for (const watcher of this.commitWatchers) watcher.dispose();
    this.commitWatchers = [];
  }

  private configuration(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration("engineeringMemory");
  }

  private safeguardSettings(): SafeguardSettings {
    const configuration = this.configuration();
    return {
      minimumConfidence: configuration.get("minimumConfidence", 0.8),
      minimumPullRequestSupport: configuration.get("minimumPullRequestSupport", 2),
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

  private async contextForDocument(document: vscode.TextDocument): Promise<{
    root: string;
    repository: string;
    dataDirectory: string;
  } | undefined> {
    if (!vscode.workspace.isTrusted || document.uri.scheme !== "file") return undefined;
    const folder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (!folder) return undefined;
    const root = folder.uri.fsPath;
    const configuredRepository = this.configuration().get<string>("repository", "").trim();
    const repository = configuredRepository || await repositoryForWorkspace(root);
    if (!repository) throw new Error("Cannot infer owner/repository from the origin remote");
    const configuredData = this.configuration().get<string>("dataDirectory", "").trim();
    const dataDirectory = configuredData ? (isAbsolute(configuredData) ? configuredData : resolve(root, configuredData)) : join(root, "data");
    return { root, repository, dataDirectory };
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
      const result = await validateMemory(context.repository, diff, context.dataDirectory);
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
      const diff = await stagedDiff(root);
      if (!diff.trim()) {
        this.status.text = "$(shield-check) Memory: nothing staged";
        return;
      }
      this.status.text = "$(sync~spin) Memory checking";
      const result = await validateMemory(repository, diff, dataDirectory);
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
      const dataDirectory = configuredData
        ? (isAbsolute(configuredData) ? configuredData : resolve(folder.uri.fsPath, configuredData))
        : join(folder.uri.fsPath, "data");
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

export function activate(context: vscode.ExtensionContext): void {
  new MemoryController(context);
}

export function deactivate(): void {}
