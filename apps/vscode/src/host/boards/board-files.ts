import * as vscode from "vscode"

const EXCLUDED = "**/node_modules/**"
const FOLDER = [".pulse", "boards"] as const
const SUFFIX = ".board.json"

export class BoardFiles {
  static readonly GLOB = "**/.pulse/boards/*.board.json"

  static async find(): Promise<readonly vscode.Uri[]> {
    const found = await vscode.workspace.findFiles(BoardFiles.GLOB, EXCLUDED)
    return [...found].sort((left, right) => left.path.localeCompare(right.path))
  }

  static async read(file: vscode.Uri): Promise<string> {
    return new TextDecoder().decode(await vscode.workspace.fs.readFile(file))
  }

  static nameOf(file: vscode.Uri): string {
    return file.path.slice(file.path.lastIndexOf("/") + 1)
  }

  static fileIn(folder: vscode.Uri, slug: string): vscode.Uri {
    return vscode.Uri.joinPath(folder, ...FOLDER, `${slug}${SUFFIX}`)
  }

  static template(title: string, engines: readonly string[], process?: string): string {
    const filter = process === undefined ? {} : { process }
    const board = {
      schemaVersion: 1,
      title,
      engines,
      rows: [
        {
          row: [
            { widget: "counter", props: { title: "Running", filter } },
            {
              widget: "counter",
              props: { title: "With incident", filter: { ...filter, withIncident: true } },
            },
            { widget: "incidentSummary", props: { groupBy: "process" } },
          ],
        },
        { row: [{ widget: "instanceList", props: { filter } }] },
      ],
    }
    return `${JSON.stringify(board, undefined, 2)}\n`
  }
}
