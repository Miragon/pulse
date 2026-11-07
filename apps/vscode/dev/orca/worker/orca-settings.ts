import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import type { Environment } from "../../../src/core/protocol/index.js"
import type { EnvironmentSettings } from "../../../src/host/connections/pulse-settings.js"
import { WritePolicy, type WritesSetting } from "../../../src/host/connections/write-policy.js"
import type { OrcaWorkerApi } from "orca/worker"

const ENVIRONMENTS: readonly Environment[] = ["local", "test", "production", "unclassified"]
const WORKSPACE_ENVIRONMENTS_KEY = "pulse.environments"

type Scoped = Readonly<Record<string, unknown>>

export class OrcaSettings {
  constructor(private readonly orca: OrcaWorkerApi) {}

  async projectFile(): Promise<string> {
    const value = await this.orca.settings.get("projectFile")
    return typeof value === "string" ? value.trim() : ""
  }

  async writes(): Promise<WritesSetting> {
    return WritePolicy.settingOf(await this.orca.settings.get("writes"))
  }

  async liveUpdates(): Promise<Scoped> {
    const entries = await Promise.all(
      ENVIRONMENTS.map(async (environment): Promise<[string, unknown]> => [
        environment,
        await this.orca.settings.get(OrcaSettings.liveKey(environment)),
      ]),
    )
    return Object.fromEntries(entries.filter(([, value]) => value === "on" || value === "off"))
  }

  async environments(projectFiles: readonly string[]): Promise<EnvironmentSettings> {
    const user = OrcaSettings.scoped(await this.orca.settings.get("environments"))
    const workspace = await Promise.all(
      projectFiles.map((file) => OrcaSettings.workspaceEnvironments(file)),
    )
    return { user, workspace }
  }

  async turnOnLiveUpdates(environment: Environment): Promise<void> {
    await this.orca.settings.set(OrcaSettings.liveKey(environment), "on")
  }

  async setProjectFile(path: string): Promise<void> {
    await this.orca.settings.set("projectFile", path)
  }

  static liveKey(environment: Environment): string {
    return `liveUpdates.${environment}`
  }

  private static async workspaceEnvironments(projectFile: string): Promise<Scoped | undefined> {
    const path = join(dirname(projectFile), ".vscode", "settings.json")
    const text = await readFile(path, "utf8").catch(() => "{}")
    return OrcaSettings.scoped(OrcaSettings.parsed(text)?.[WORKSPACE_ENVIRONMENTS_KEY])
  }

  private static scoped(value: unknown): Scoped | undefined {
    if (typeof value === "string") {
      return OrcaSettings.parsed(value)
    }
    return typeof value === "object" && value !== null ? (value as Scoped) : undefined
  }

  private static parsed(text: string): Scoped | undefined {
    try {
      const value: unknown = JSON.parse(text)
      return typeof value === "object" && value !== null ? (value as Scoped) : undefined
    } catch {
      return undefined
    }
  }
}
