import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { CompositionRoot } from "./composition-root.js"
import {
  type Connection,
  ConnectionBuilder,
  CredentialStore,
  EngineLanes,
  LOCAL_TARGET,
  type EngineTarget,
  EnvironmentClassifier,
  LivePolicy,
  TargetsParser,
  TargetsProblem,
  type WriteAudit,
  type EnvironmentSettings,
} from "@miragon/pulse-runtime-view/host-kit"
import type { OrcaWorkerApi } from "orca/worker"
import { OrcaSecretStorage } from "./orca-secret-storage.js"
import { OrcaSettings } from "./orca-settings.js"
import type { OrcaWorkspaces } from "./orca-workspaces.js"

const PROJECT_FILE = ".pulse-cli.json"
const ACTIVE_KEY = "activeEngine"

type Listener = () => void

interface Discovered {
  readonly files: readonly string[]
  readonly targets: readonly EngineTarget[]
  readonly problems: readonly TargetsProblem[]
}

export class EngineRegistry {
  private connections: readonly Connection[] = []
  private problems: readonly TargetsProblem[] = []
  private files: readonly string[] = []
  private activeName: string | undefined
  private environments: EnvironmentSettings = { user: undefined, workspace: [] }
  private readonly lanes = new EngineLanes()
  private readonly credentials: CredentialStore
  private readonly builder: ConnectionBuilder
  private readonly changed = new Set<Listener>()
  private readonly written = new Set<Listener>()
  private reloads: Promise<void> = Promise.resolve()

  constructor(
    private readonly orca: OrcaWorkerApi,
    private readonly settings: OrcaSettings,
    private readonly workspaces: OrcaWorkspaces,
    audit: WriteAudit,
  ) {
    this.credentials = new CredentialStore(new OrcaSecretStorage(orca.secrets))
    this.builder = new ConnectionBuilder(
      CompositionRoot.create(),
      audit,
      OrcaSettings.WRITES_WORDING,
    )
  }

  reload(): Promise<void> {
    const reload = this.reloads.then(() => this.load())
    this.reloads = reload.catch(() => undefined)
    return reload
  }

  async applyLiveSettings(): Promise<void> {
    const live = await this.settings.liveUpdates()
    for (const connection of this.connections) {
      connection.live.set(LivePolicy.settingFor(connection.badge.environment, live))
    }
  }

  onDidChange(listener: Listener): () => void {
    return EngineRegistry.subscribe(this.changed, listener)
  }

  onDidWrite(listener: Listener): () => void {
    return EngineRegistry.subscribe(this.written, listener)
  }

  all(): readonly Connection[] {
    return this.connections
  }

  byName(name: string): Connection | undefined {
    return this.connections.find((connection) => connection.target.name === name)
  }

  active(): Connection | undefined {
    return (
      (this.activeName === undefined ? undefined : this.byName(this.activeName)) ??
      this.connections[0]
    )
  }

  async activate(name: string): Promise<void> {
    this.activeName = name
    await this.orca.storage.set(ACTIVE_KEY, name)
    EngineRegistry.fire(this.changed)
  }

  environmentSettings(): EnvironmentSettings {
    return this.environments
  }

  projectFiles(): readonly string[] {
    return this.files
  }

  configurationProblems(): readonly TargetsProblem[] {
    return this.problems
  }

  noteWrite(): void {
    for (const connection of this.connections) {
      connection.definitions.forget()
    }
    EngineRegistry.fire(this.written)
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

  private async load(): Promise<void> {
    const discovered = await this.discover()
    const environments = await this.settings.environments(discovered.files)
    this.environments = environments
    const writes = await this.settings.writes()
    const live = await this.settings.liveUpdates()
    const stored = await this.orca.storage.get(ACTIVE_KEY)
    this.activeName = typeof stored === "string" ? stored : undefined
    const requests = await Promise.all(
      discovered.targets.map(async (target) => ({
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
          writes,
          live,
          lane,
        },
      ),
    )
    this.files = discovered.files
    this.problems = discovered.problems
    EngineRegistry.fire(this.changed)
  }

  private async discover(): Promise<Discovered> {
    const configured = await this.settings.projectFile()
    const files = configured === "" ? await this.focusedProjectFile() : [configured]
    const targets: EngineTarget[] = []
    const problems: TargetsProblem[] = []
    const found: string[] = []
    for (const file of files) {
      const text = await readFile(file, "utf8").catch(() => undefined)
      if (text === undefined) {
        if (file === configured) {
          problems.push(new TargetsProblem(file, "Pulse can't read this file"))
        }
        continue
      }
      found.push(file)
      const parsed = new TargetsParser(file).parse(text)
      targets.push(
        ...parsed.targets.filter((target) => !targets.some((known) => known.name === target.name)),
      )
      problems.push(...parsed.problems)
    }
    return { files: found, targets: targets.length === 0 ? [LOCAL_TARGET] : targets, problems }
  }

  private async focusedProjectFile(): Promise<readonly string[]> {
    const focused = await this.workspaces.focusedWorkspace()
    return focused === undefined ? [] : [join(focused.path, PROJECT_FILE)]
  }

  private static subscribe(listeners: Set<Listener>, listener: Listener): () => void {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }

  private static fire(listeners: ReadonlySet<Listener>): void {
    for (const listener of [...listeners]) {
      listener()
    }
  }
}
