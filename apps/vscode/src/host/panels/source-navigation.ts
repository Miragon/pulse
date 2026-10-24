import type { SourceLocation } from '../../contract/index.js';
import * as vscode from 'vscode';

const MODELER_FOCUS_COMMAND = 'bpmn-modeler.focusLintElement';
const MODELER_EDITOR = 'bpmn-modeler.bpmn';

interface ContributedCommands {
  readonly contributes?: { readonly commands?: readonly { readonly command?: string }[] };
}

export class SourceNavigation {
  async openModel(location: SourceLocation, elementId?: string): Promise<void> {
    if (elementId === undefined) {
      await vscode.commands.executeCommand(
        'vscode.open',
        vscode.Uri.parse(location.uri),
        vscode.ViewColumn.Active,
      );
      return;
    }
    if (!(await this.focusInModeler(location.uri, elementId))) {
      await this.openSource(location);
    }
  }

  async openSource(location: SourceLocation): Promise<void> {
    const position = new vscode.Position(Math.max(location.line - 1, 0), 0);
    await vscode.window.showTextDocument(vscode.Uri.parse(location.uri), {
      preview: true,
      viewColumn: vscode.ViewColumn.Active,
      selection: new vscode.Range(position, position),
    });
  }

  private async focusInModeler(uri: string, elementId: string): Promise<boolean> {
    if (!this.modelerInstalled()) {
      return false;
    }
    try {
      await vscode.commands.executeCommand(
        'vscode.openWith',
        vscode.Uri.parse(uri),
        MODELER_EDITOR,
        vscode.ViewColumn.Active,
      );
      await vscode.commands.executeCommand(MODELER_FOCUS_COMMAND, uri, elementId);
      return true;
    } catch {
      return false;
    }
  }

  private modelerInstalled(): boolean {
    return vscode.extensions.all.some((extension) =>
      ((extension.packageJSON as ContributedCommands).contributes?.commands ?? []).some(
        (contribution) => contribution.command === MODELER_FOCUS_COMMAND,
      ),
    );
  }
}
