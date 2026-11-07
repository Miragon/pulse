import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { CompositionRoot } from "../../../src/host/composition-root.js"
import type { Connection } from "../../../src/host/connections/connection.js"
import { ConnectionBuilder } from "../../../src/host/connections/connection-builder.js"
import { CredentialStore } from "../../../src/host/connections/credential-store.js"
import { EngineLanes } from "../../../src/host/connections/engine-lanes.js"
import { EnvironmentClassifier } from "../../../src/host/connections/environment-classifier.js"
import type { EnvironmentSettings } from "../../../src/host/connections/pulse-settings.js"
import { TargetsParser } from "../../../src/host/connections/targets-parser.js"
import { WriteAudit } from "../../../src/host/connections/write-audit.js"
import type { OrcaWorkerApi } from "orca/worker"
import { OrcaSecretStorage } from "./orca-secret-storage.js"

const ENVIRONMENTS_KEY = "pulse.environments"

export class EngineDirectory {
  private connections: readonly Connection[] = []
  private problems: readonly string[] = []
  private file = ""
  private readonly lanes = new EngineLanes()
  private readonly credentials: CredentialStore
  private readonly builder: ConnectionBuilder

  constructor(private readonly orca: OrcaWorkerApi) {
    this.credentials = new CredentialStore(new OrcaSecretStorage(orca.secrets))
    this.builder = new ConnectionBuilder(
      CompositionRoot.create(),
      new WriteAudit({
        info: (message) => {
          orca.log(message)
        },
      }),
    )
  }

  async reload(): Promise<void> {
    const setting = await this.orca.settings.get("projectFile")
    this.file = typeof setting === "string" ? setting.trim() : ""
    if (this.file === "") {
      this.connections = []
      this.problems = []
      return
    }
    const text = await readFile(this.file, "utf8").catch(() => undefined)
    if (text === undefined) {
      this.connections = []
      this.problems = [`Can't read ${this.file}.`]
      return
    }
    await this.connect(text)
  }

  projectFile(): string {
    return this.file
  }

  all(): readonly Connection[] {
    return this.connections
  }

  configurationProblems(): readonly string[] {
    return this.problems
  }

  byName(name: string): Connection | undefined {
    return this.connections.find((connection) => connection.target.name === name)
  }

  async saveLogin(name: string, username: string, password: string): Promise<boolean> {
    const connection = this.byName(name)
    if (connection === undefined) {
      return false
    }
    await this.credentials.write(connection.target, username, password)
    await this.reload()
    return true
  }

  private async connect(text: string): Promise<void> {
    const parsed = new TargetsParser(this.file).parse(text)
    const environments = await this.environments()
    const requests = await Promise.all(
      parsed.targets.map(async (target) => ({
        target,
        credentials: await this.credentials.read(target),
      })),
    )
    this.connections = this.lanes.assign(requests).map(({ target, credentials, lane }) =>
      this.builder.build(
        target,
        credentials,
        EnvironmentClassifier.classify(target, environments),
        {
          writes: "disabled",
          live: undefined,
          lane,
        },
      ),
    )
    this.problems = parsed.problems.map((problem) => problem.label())
  }

  private async environments(): Promise<EnvironmentSettings> {
    const path = join(dirname(this.file), ".vscode", "settings.json")
    const text = await readFile(path, "utf8").catch(() => "{}")
    const settings = EngineDirectory.parsed(text)
    const scoped = settings[ENVIRONMENTS_KEY]
    const workspace =
      typeof scoped === "object" && scoped !== null
        ? (scoped as Record<string, unknown>)
        : undefined
    return { user: undefined, workspace: [workspace] }
  }

  private static parsed(text: string): Readonly<Record<string, unknown>> {
    try {
      const value: unknown = JSON.parse(text)
      return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {}
    } catch {
      return {}
    }
  }
}
