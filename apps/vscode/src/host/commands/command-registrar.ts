import * as vscode from 'vscode';
import type { Command } from './command.js';

export class CommandRegistrar {
  static register(commands: readonly Command[]): vscode.Disposable {
    return vscode.Disposable.from(
      ...commands.map((command) =>
        vscode.commands.registerCommand(command.id, (...args: unknown[]) => command.run(...args)),
      ),
    );
  }
}
