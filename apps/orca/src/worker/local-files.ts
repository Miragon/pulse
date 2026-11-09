import { mkdir, readFile, writeFile } from "node:fs/promises"
import { basename, dirname, join, relative } from "node:path"
import { BpmnProcessIds } from "@miragon/pulse-runtime-view/core"
import type { FileRow, ModelRow } from "../protocol.js"
import { OrcaWorkspaceFiles } from "./orca-workspace-files.js"

const BOARD_GLOB = "**/.pulse/boards/*.board.json"
const MODEL_GLOB = "**/*.bpmn"
const MAX_FILES = 200
const PROJECT_TEMPLATE = `${JSON.stringify(
  { profiles: { local: { url: "http://localhost:8080/engine-rest" } } },
  undefined,
  2,
)}\n`

export class LocalFiles {
  private readonly finder: OrcaWorkspaceFiles

  constructor(private readonly roots: () => readonly string[]) {
    this.finder = new OrcaWorkspaceFiles(roots)
  }

  async boards(): Promise<readonly FileRow[]> {
    const paths = await this.paths(BOARD_GLOB)
    return paths.map((path) => ({
      path,
      label: basename(path, ".board.json"),
      description: this.shown(dirname(dirname(dirname(path)))),
    }))
  }

  async models(): Promise<readonly ModelRow[]> {
    const rows: ModelRow[] = []
    for (const path of await this.paths(MODEL_GLOB)) {
      const xml = await readFile(path, "utf8").catch(() => "")
      for (const bpmnProcessId of BpmnProcessIds.of(xml)) {
        rows.push({ path, bpmnProcessId, label: basename(path), description: bpmnProcessId })
      }
    }
    return rows
  }

  async createBoard(root: string, slug: string, content: string): Promise<string> {
    const file = join(root, ".pulse", "boards", `${slug}.board.json`)
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, content, { flag: "wx" }).catch(() => undefined)
    return file
  }

  static async ensureProjectFile(path: string): Promise<string> {
    await writeFile(path, PROJECT_TEMPLATE, { flag: "wx" }).catch(() => undefined)
    return path
  }

  private async paths(pattern: string): Promise<readonly string[]> {
    const found = await this.finder.find(pattern, MAX_FILES)
    return [...new Set(found.map((uri) => OrcaWorkspaceFiles.pathOf(uri)))].sort()
  }

  private shown(folder: string): string {
    const root = this.roots().find((candidate) => folder.startsWith(candidate))
    return root === undefined ? folder : relative(root, folder) || basename(folder)
  }
}
