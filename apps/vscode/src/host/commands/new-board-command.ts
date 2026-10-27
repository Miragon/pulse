import * as vscode from "vscode"
import { BoardFiles } from "../boards/board-files.js"
import type { BoardPanels } from "../boards/board-panels.js"
import type { ConnectionRegistry } from "../connections/connection-registry.js"
import type { Command } from "./command.js"
import { COMMAND } from "./command-ids.js"

const SLUG_PARTS = /[^a-z0-9]+/g

export class NewBoardCommand implements Command {
  readonly id = COMMAND.newBoard

  constructor(
    private readonly registry: ConnectionRegistry,
    private readonly boards: BoardPanels,
  ) {}

  async run(): Promise<void> {
    const folder = vscode.workspace.workspaceFolders?.[0]
    if (folder === undefined) {
      void vscode.window.showInformationMessage("Open a folder to keep boards in .pulse/boards.")
      return
    }
    const title = await vscode.window.showInputBox({
      title: "New board",
      prompt: "Name the board, for example Shop: Payments",
      validateInput: (value) => this.problemWith(folder.uri, value),
    })
    if (title === undefined) {
      return
    }
    const file = BoardFiles.fileIn(folder.uri, this.slugOf(title))
    const engines = this.registry.all().map((connection) => connection.target.name)
    await vscode.workspace.fs.writeFile(
      file,
      new TextEncoder().encode(BoardFiles.template(title.trim(), engines)),
    )
    await vscode.window.showTextDocument(file)
    this.boards.open(file)
  }

  private async problemWith(folder: vscode.Uri, title: string): Promise<string | undefined> {
    const slug = this.slugOf(title)
    if (slug === "") {
      return "Enter a name with letters or digits."
    }
    const file = BoardFiles.fileIn(folder, slug)
    const taken = await vscode.workspace.fs.stat(file).then(
      () => true,
      () => false,
    )
    return taken ? `${BoardFiles.nameOf(file)} exists. Choose another name.` : undefined
  }

  private slugOf(title: string): string {
    return title.toLowerCase().replace(SLUG_PARTS, "-").replace(/^-|-$/g, "")
  }
}
