import type { UserConfigRow } from "../protocol.js"
import type { EngineRegistry } from "./engine-registry.js"
import type { OrcaWorkspaces } from "./orca-workspaces.js"

export class UserConfigFile {
  constructor(
    private readonly registry: EngineRegistry,
    private readonly workspaces: OrcaWorkspaces,
  ) {}

  path(): string {
    return this.registry.userConfigLocation().path
  }

  named(): boolean {
    return this.registry.userConfigLocation().explicit
  }

  async row(): Promise<UserConfigRow> {
    const verdict = this.registry.userConfigVerdict()
    return {
      path: this.path(),
      named: this.named(),
      present: verdict !== undefined && verdict.kind !== "missing",
      openable: (await this.openable()) !== undefined,
    }
  }

  async open(): Promise<boolean> {
    const file = await this.openable()
    if (file === undefined) {
      return false
    }
    await this.workspaces.openFile(file)
    return true
  }

  private async openable(): Promise<string | undefined> {
    const verdict = this.registry.userConfigVerdict()
    if (verdict?.kind !== "read") {
      return undefined
    }
    return (await this.workspaces.holding(verdict.path)) === undefined ? undefined : verdict.path
  }
}
