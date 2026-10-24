import * as vscode from 'vscode';

export class TargetsFile {
  static readonly GLOB = '**/.operate.json';

  static readonly TEMPLATE = `${JSON.stringify(
    { profiles: { local: { url: 'http://localhost:8080/engine-rest' } } },
    undefined,
    2,
  )}\n`;

  static in(folder: vscode.Uri): vscode.Uri {
    return vscode.Uri.joinPath(folder, '.operate.json');
  }
}
