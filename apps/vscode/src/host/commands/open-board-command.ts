import * as vscode from "vscode"
import type { BoardPanels } from "../boards/board-panels.js"
import type { Command } from "./command.js"
import { COMMAND } from "./command-ids.js"

export class OpenBoardCommand implements Command {
  readonly id = COMMAND.openBoard

  constructor(private readonly boards: BoardPanels) {}

  run(file?: unknown): void {
    if (file instanceof vscode.Uri) {
      this.boards.open(file)
    }
  }
}
