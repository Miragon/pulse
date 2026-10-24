import type { WorkspaceFiles } from '../../contract/index.js';
import * as vscode from 'vscode';

const EXCLUDED = '**/{node_modules,target,build,dist,out,.git}/**';

export class VsCodeWorkspaceFiles implements WorkspaceFiles {
  async find(glob: string, limit: number): Promise<readonly string[]> {
    const files = await vscode.workspace.findFiles(glob, EXCLUDED, limit);
    return files.map((file) => file.toString());
  }

  async read(uri: string): Promise<string> {
    return new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.parse(uri)));
  }
}
