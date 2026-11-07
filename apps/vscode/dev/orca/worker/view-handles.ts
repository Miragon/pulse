import { mkdir, writeFile } from "node:fs/promises"
import { join, relative, sep } from "node:path"
import type { OrcaWorkerApi } from "orca/worker"
import type { ViewHandle, ViewRequest } from "../protocol.js"

const FOLDER = join(".pulse", "views")

interface Workspace {
  readonly id: string
  readonly path: string
  readonly hostId: string | null
}

export class ViewHandles {
  constructor(private readonly orca: OrcaWorkerApi) {}

  async open(projectFile: string, request: ViewRequest): Promise<string> {
    const workspace = await this.workspaceHolding(projectFile)
    const handle: ViewHandle = { pulse: 1, ...request }
    const file = join(workspace.path, FOLDER, request.engine, ViewHandles.fileName(handle))
    await mkdir(join(workspace.path, FOLDER, request.engine), { recursive: true })
    await writeFile(join(workspace.path, FOLDER, ".gitignore"), "*\n")
    await writeFile(file, `${JSON.stringify(handle, null, 2)}\n`)
    const path = relative(workspace.path, file).split(sep).join("/")
    await this.orca.host.call("workspace.open", { workspaceId: workspace.id })
    await this.orca.host.call("editor.open", { workspaceId: workspace.id, path })
    return path
  }

  static parse(text: string): ViewHandle | undefined {
    try {
      const value = JSON.parse(text) as Partial<ViewHandle>
      return value.pulse === 1 && typeof value.engine === "string"
        ? (value as ViewHandle)
        : undefined
    } catch {
      return undefined
    }
  }

  private static isLocal(workspace: Workspace): boolean {
    return workspace.hostId === null || workspace.hostId === "local"
  }

  private static fileName(handle: ViewHandle): string {
    const key = handle.view === "definition" ? handle.bpmnProcessId : handle.instanceId
    return `${handle.view}-${key.replace(/[^\w.-]/g, "_")}.pulse-view`
  }

  private async workspaceHolding(projectFile: string): Promise<Workspace> {
    const answer = (await this.orca.host.call("workspace.list")) as {
      workspaces: readonly Workspace[]
    }
    const holding = answer.workspaces
      .filter(
        (workspace) =>
          ViewHandles.isLocal(workspace) && projectFile.startsWith(workspace.path + sep),
      )
      .sort((left, right) => right.path.length - left.path.length)[0]
    if (holding === undefined) {
      throw new Error(`No local Orca workspace holds ${projectFile}.`)
    }
    return holding
  }
}
