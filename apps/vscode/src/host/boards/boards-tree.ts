import { BoardParser, BoardTiles } from "@miragon/pulse-board"
import * as vscode from "vscode"
import { COMMAND } from "../commands/command-ids.js"
import { BoardFiles } from "./board-files.js"

export interface BoardNode {
  readonly file: vscode.Uri
  readonly title?: string
  readonly problems: number
  readonly notes: number
}

const HAS_BOARDS = "pulse.hasBoards"

export class BoardsTree implements vscode.TreeDataProvider<BoardNode>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<BoardNode | undefined>()
  readonly onDidChangeTreeData = this.changed.event
  private readonly view: vscode.TreeView<BoardNode>

  constructor() {
    this.view = vscode.window.createTreeView("pulse.boards", { treeDataProvider: this })
    void this.announce()
  }

  refresh(): void {
    this.changed.fire(undefined)
    void this.announce()
  }

  getTreeItem(node: BoardNode): vscode.TreeItem {
    const name = BoardFiles.nameOf(node.file)
    const item = new vscode.TreeItem(node.title ?? name, vscode.TreeItemCollapsibleState.None)
    item.description = this.descriptionOf(node, name)
    item.tooltip = node.file.fsPath
    item.accessibilityInformation = { label: `${node.title ?? name}, ${item.description}` }
    item.contextValue = "pulse.board"
    item.iconPath =
      node.problems === 0
        ? new vscode.ThemeIcon("dashboard")
        : new vscode.ThemeIcon("error", new vscode.ThemeColor("problemsErrorIcon.foreground"))
    item.command = { command: COMMAND.openBoard, title: "Open Board", arguments: [node.file] }
    return item
  }

  async getChildren(node?: BoardNode): Promise<BoardNode[]> {
    if (node !== undefined) {
      return []
    }
    const files = await BoardFiles.find()
    return Promise.all(files.map((file) => this.nodeOf(file)))
  }

  dispose(): void {
    this.view.dispose()
    this.changed.dispose()
  }

  private async announce(): Promise<void> {
    const files = await BoardFiles.find()
    await vscode.commands.executeCommand("setContext", HAS_BOARDS, files.length > 0)
  }

  private async nodeOf(file: vscode.Uri): Promise<BoardNode> {
    const content = await BoardFiles.read(file).catch(() => "")
    const parsed = BoardParser.parse(content)
    if ("problems" in parsed) {
      return { file, problems: parsed.problems.length, notes: 0 }
    }
    const refused = BoardTiles.of(parsed.board)
      .flat()
      .flatMap((tile) => ("refused" in tile ? tile.refused : []))
    return { file, title: parsed.board.title, problems: refused.length, notes: parsed.notes.length }
  }

  private descriptionOf(node: BoardNode, name: string): string {
    const counted = this.countOf(node)
    if (counted === undefined) {
      return name
    }
    return node.title === undefined ? counted : `${name} · ${counted}`
  }

  private countOf(node: BoardNode): string | undefined {
    if (node.problems > 0) {
      return this.plural(node.problems, "problem")
    }
    return node.notes > 0 ? this.plural(node.notes, "note") : undefined
  }

  private plural(count: number, noun: string): string {
    return `${count} ${count === 1 ? noun : `${noun}s`}`
  }
}
