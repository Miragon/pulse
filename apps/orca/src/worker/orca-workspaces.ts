import { relative, sep } from "node:path"
import type { OrcaWorkerApi } from "orca/worker"

export interface Workspace {
  readonly id: string
  readonly name: string
  readonly path: string
  readonly branch: string | null
  readonly hostId: string | null
}

interface FocusedContext {
  readonly branch: string
  readonly displayName: string
}

export class OrcaWorkspaces {
  private focused: FocusedContext | null = null

  constructor(private readonly orca: OrcaWorkerApi) {}

  noteFocus(context: FocusedContext | null): void {
    this.focused = context
  }

  async focusedWorkspace(): Promise<Workspace | undefined> {
    const local = await this.local()
    const context = this.focused ?? (await this.readContext())
    const match = local.find(
      (workspace) =>
        context !== null &&
        workspace.name === context.displayName &&
        (workspace.branch ?? "") === context.branch,
    )
    return match ?? local[0]
  }

  async holding(path: string): Promise<Workspace | undefined> {
    const local = await this.local()
    return local
      .filter((workspace) => path === workspace.path || path.startsWith(workspace.path + sep))
      .sort((left, right) => right.path.length - left.path.length)[0]
  }

  async openFile(path: string): Promise<void> {
    const workspace = await this.holding(path)
    if (workspace === undefined) {
      throw new Error(`No local Orca workspace holds ${path}.`)
    }
    const inside = relative(workspace.path, path).split(sep).join("/")
    await this.orca.host.call("workspace.open", { workspaceId: workspace.id })
    await this.orca.host.call("editor.open", { workspaceId: workspace.id, path: inside })
  }

  private async local(): Promise<readonly Workspace[]> {
    const answer = (await this.orca.host
      .call("workspace.list")
      .catch(() => ({ workspaces: [] }))) as { workspaces: readonly Workspace[] }
    return answer.workspaces.filter(
      (workspace) => workspace.hostId === null || workspace.hostId === "local",
    )
  }

  private async readContext(): Promise<FocusedContext | null> {
    const context = (await this.orca.host
      .call("workspace.readContext")
      .catch(() => null)) as FocusedContext | null
    return context
  }
}
