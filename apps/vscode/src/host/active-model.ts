import * as vscode from "vscode"

export class ActiveModel {
  static uri(): vscode.Uri | undefined {
    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input
    if (input instanceof vscode.TabInputCustom || input instanceof vscode.TabInputText) {
      return input.uri
    }
    return vscode.window.activeTextEditor?.document.uri
  }
}
