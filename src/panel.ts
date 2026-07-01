import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { ParsedFsm } from './parser';
import { buildPanelHtml, ThemeHint } from './panelHtml';

export class FsmPanel {
  public static currentPanel: FsmPanel | undefined;
  private static _savedTheme: boolean | null = null;
  private static readonly viewType = 'vhdlFsmDiagram';
  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];
  private _docUri: vscode.Uri | undefined;
  private _lightTheme: boolean | null = null;
  public locked: boolean = false;

  public static createOrShow(extensionUri: vscode.Uri, fsms: ParsedFsm[], title: string, docUri?: vscode.Uri, preserveFocus = false): void {
    const col = vscode.window.activeTextEditor ? vscode.ViewColumn.Beside : vscode.ViewColumn.One;
    if (FsmPanel.currentPanel && !FsmPanel.currentPanel.locked) {
      FsmPanel.currentPanel._panel.reveal(col, preserveFocus);
      FsmPanel.currentPanel._docUri = docUri;
      FsmPanel.currentPanel._update(fsms, title);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      FsmPanel.viewType, 'FSM Diagram', { viewColumn: col, preserveFocus },
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [extensionUri] }
    );
    FsmPanel.currentPanel = new FsmPanel(panel, extensionUri);
    FsmPanel.currentPanel._lightTheme = FsmPanel._savedTheme;
    FsmPanel.currentPanel._docUri = docUri;
    FsmPanel.currentPanel._update(fsms, title);
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    this._panel.webview.onDidReceiveMessage(async (msg: any) => {
      if (msg.command === 'goToLine' && typeof msg.line === 'number') {
        await this._goToLine(msg.line);
      }
      if (msg.type === 'themeChange' && typeof msg.isLight === 'boolean') {
        this._lightTheme = msg.isLight;
        FsmPanel._savedTheme = msg.isLight;
      }
      if (msg.type === 'lockChange' && typeof msg.locked === 'boolean') {
        this.locked = msg.locked;
      }
    }, null, this._disposables);
  }

  private async _goToLine(line1Based: number): Promise<void> {
    if (!this._docUri) return;
    const line = Math.max(0, line1Based - 1);
    const range = new vscode.Range(line, 0, line, 0);

    const visible = vscode.window.visibleTextEditors.find(
      e => e.document.uri.toString() === this._docUri!.toString()
    );
    const editor = visible ?? await vscode.window.showTextDocument(this._docUri, {
      viewColumn: vscode.ViewColumn.One,
      preserveFocus: false,
    });

    editor.selection = new vscode.Selection(range.start, range.end);
    editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
    await vscode.window.showTextDocument(editor.document, {
      viewColumn: editor.viewColumn,
      preserveFocus: false,
    });
  }

  public update(fsms: ParsedFsm[], title: string, docUri?: vscode.Uri): void {
    if (docUri) this._docUri = docUri;
    if (this._panel.visible) this._update(fsms, title);
  }

  private _update(fsms: ParsedFsm[], title: string): void {
    this._panel.title = `FSM: ${title}`;
    this._panel.webview.html = this._getHtml(fsms, title);
  }

  public dispose(): void {
    FsmPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) { const d = this._disposables.pop(); if (d) d.dispose(); }
  }

  private _getHtml(fsms: ParsedFsm[], title: string): string {
    const themeHint: ThemeHint = this._lightTheme === null ? 'auto'
                    : this._lightTheme ? 'light' : 'dark';
    // Per-render nonce for CSP — prevents injected scripts from running.
    const nonce = crypto.randomBytes(16).toString('base64');
    return buildPanelHtml(fsms, title, themeHint, nonce);
  }
}
