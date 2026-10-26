import * as vscode from "vscode"
import { BoardFiles } from "./board-files.js"
import type { BoardPanels } from "./board-panels.js"
import type { BoardsTree } from "./boards-tree.js"

export class BoardWatcher implements vscode.Disposable {
  private readonly subscription: vscode.Disposable

  constructor(tree: BoardsTree, panels: BoardPanels) {
    const watcher = vscode.workspace.createFileSystemWatcher(BoardFiles.GLOB)
    const changed = (file: vscode.Uri): void => {
      tree.refresh()
      panels.changed(file)
    }
    this.subscription = vscode.Disposable.from(
      watcher,
      watcher.onDidChange(changed),
      watcher.onDidCreate(changed),
      watcher.onDidDelete(changed),
    )
  }

  dispose(): void {
    this.subscription.dispose()
  }
}
