import * as vscode from "vscode";
import { nonce, renderSidebarHtml, type SidebarSnapshot } from "./sidebarView.js";

/** The subset of MemoryController the sidebar needs — kept as an interface so this file never imports extension.ts. */
export interface SidebarController {
  readonly onDidChangeStatus: vscode.Event<void>;
  getSidebarSnapshot(): Promise<SidebarSnapshot>;
  signInToGitHub(): Promise<void>;
  initializeRepository(): Promise<void>;
  syncNow(): Promise<void>;
  showCurrentMemory(): Promise<void>;
}

export class EngineeringMemorySidebarProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;

  constructor(private readonly controller: SidebarController) {
    controller.onDidChangeStatus(() => void this.refresh());
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.onDidReceiveMessage((message: { command?: string }) => void this.handleMessage(message.command));
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) void this.refresh();
    });
    void this.refresh();
  }

  private async handleMessage(command: string | undefined): Promise<void> {
    switch (command) {
      case "trustWorkspace":
        await vscode.commands.executeCommand("workbench.trust.manage");
        break;
      case "signIn":
        await this.controller.signInToGitHub();
        break;
      case "initialize":
        await this.controller.initializeRepository();
        break;
      case "syncNow":
        await this.controller.syncNow();
        break;
      case "showMemory":
        await this.controller.showCurrentMemory();
        break;
      default:
        return;
    }
    await this.refresh();
  }

  private async refresh(): Promise<void> {
    if (!this.view) return;
    const snapshot = await this.controller.getSidebarSnapshot();
    this.view.webview.html = renderSidebarHtml(snapshot, nonce());
  }
}
