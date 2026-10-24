import { BpmnProcessId } from '../../contract/index.js';
import { BpmnProcessIds } from '../../core/index.js';
import { basename } from 'node:path';
import * as vscode from 'vscode';
import { ActiveModel } from '../active-model.js';
import type { ConnectionRegistry } from '../connections/connection-registry.js';
import type { PanelManager } from '../panels/panel-manager.js';
import type { Command } from './command.js';
import { COMMAND } from './command-ids.js';

export class ShowRuntimeDataCommand implements Command {
  readonly id = COMMAND.showRuntimeData;

  constructor(
    private readonly registry: ConnectionRegistry,
    private readonly panels: PanelManager,
  ) {}

  async run(uri: unknown): Promise<void> {
    const connection = this.registry.active();
    const file = uri instanceof vscode.Uri ? uri : ActiveModel.uri();
    if (connection === undefined || file === undefined) {
      void vscode.window.showInformationMessage(
        'Open a .bpmn file and configure an engine to see its runtime data.',
      );
      return;
    }
    const xml = new TextDecoder().decode(await vscode.workspace.fs.readFile(file));
    const fileName = basename(file.fsPath);
    const bpmnProcessId = await this.chooseProcess(BpmnProcessIds.of(xml), fileName);
    if (bpmnProcessId === undefined) {
      void vscode.window.showInformationMessage(`${fileName} contains no process.`);
      return;
    }
    this.panels.openModel(
      connection,
      { bpmnProcessId: BpmnProcessId(bpmnProcessId), localModel: { fileName, xml } },
      file,
    );
  }

  private async chooseProcess(
    ids: readonly string[],
    fileName: string,
  ): Promise<string | undefined> {
    if (ids.length <= 1) {
      return ids[0];
    }
    return vscode.window.showQuickPick(ids, { title: `Which process of ${fileName}?` });
  }
}
