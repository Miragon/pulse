import { access, readFile } from "node:fs/promises"
import { join } from "node:path"
import { CompositionRoot } from "./composition-root.js"
import {
  type Connection,
  ConnectionBuilder,
  CredentialStore,
  type DiscoveredTargets,
  EngineLanes,
  type EngineRoot,
  EnvironmentClassifier,
  type FileVerdict,
  LivePolicy,
  ProjectFile,
  TargetMerge,
  type TargetsProblem,
  type UserConfigLocation,
  UserConfigRead,
  type UserConfigVerdict,
  type WriteAudit,
  type EnvironmentSettings,
} from "@miragon/pulse-runtime-view/host-kit"
import type { OrcaWorkerApi } from "orca/worker"
import { OrcaSecretStorage } from "./orca-secret-storage.js"
import { OrcaSettings } from "./orca-settings.js"
import type { OrcaWorkspaces } from "./orca-workspaces.js"

const ACTIVE_KEY = "activeEngine"

type Listener = () => void

export interface RegistryWiring {
  readonly audit: WriteAudit
  readonly engines: EngineRoot
}

interface Discovered extends DiscoveredTargets {
  readonly files: readonly string[]
  readonly user: UserConfigRead
}

export class EngineRegistry {
  private connections: readonly Connection[] = []
  private problems: readonly TargetsProblem[] = []
  private files: readonly string[] = []
  private userVerdict: UserConfigVerdict | undefined
  private activeName: string | undefined
  private environments: EnvironmentSettings = { user: undefined, workspace: [] }
  private readonly lanes = new EngineLanes()
  private readonly merge: TargetMerge
  private readonly credentials: CredentialStore
  private readonly builder: ConnectionBuilder
  private readonly location: UserConfigLocation
  private readonly changed = new Set<Listener>()
  private readonly written = new Set<Listener>()
  private reloads: Promise<void> = Promise.resolve()

  constructor(
    private readonly orca: OrcaWorkerApi,
    private readonly settings: OrcaSettings,
    private readonly workspaces: OrcaWorkspaces,
    { audit, engines }: RegistryWiring,
  ) {
    this.credentials = new CredentialStore(new OrcaSecretStorage(orca.secrets))
    this.builder = new ConnectionBuilder(engines, audit, OrcaSettings.WRITES_WORDING)
    this.merge = new TargetMerge(engines.localTarget())
    this.location = CompositionRoot.userConfig()
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
    return this.location.explicit ? [] : this.files
  }

  userConfigLocation(): UserConfigLocation {
    return this.location
  }

  userConfigVerdict(): UserConfigVerdict | undefined {
    return this.userVerdict
  }

  configurationProblems(): readonly TargetsProblem[] {
    return this.problems
  }

  formerProjectFiles(): readonly string[] {
    return this.problems
      .filter((problem) => problem.message === ProjectFile.RENAME)
      .map((problem) => problem.path)
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
    this.userVerdict = discovered.user.verdict()
    this.problems = discovered.problems
    EngineRegistry.fire(this.changed)
  }

  private async discover(): Promise<Discovered> {
    const configured = await this.settings.projectFile()
    const verdicts =
      configured === ""
        ? await this.focusedProjectFile()
        : [await EngineRegistry.configuredFile(configured)]
    const files = verdicts.flatMap((verdict) => (verdict.kind === "read" ? [verdict.path] : []))
    const user = await UserConfigRead.of(this.location, (path) =>
      EngineRegistry.configuredFile(path),
    )
    return { files, user, ...this.merge.merge(verdicts, user) }
  }

  private async focusedProjectFile(): Promise<readonly FileVerdict[]> {
    const focused = await this.workspaces.focusedWorkspace()
    if (focused === undefined) {
      return []
    }
    const verdict = await EngineRegistry.verdictOf(join(focused.path, ProjectFile.NAME))
    if (verdict !== undefined) {
      return [verdict]
    }
    const former = join(focused.path, ProjectFile.FORMER_NAME)
    const present = await access(former).then(
      () => true,
      () => false,
    )
    return present ? [{ kind: "former-name", path: former }] : []
  }

  private static async configuredFile(file: string): Promise<UserConfigVerdict> {
    return (await EngineRegistry.verdictOf(file)) ?? { kind: "missing", path: file }
  }

  private static async verdictOf(file: string): Promise<UserConfigVerdict | undefined> {
    try {
      return { kind: "read", path: file, text: await readFile(file, "utf8") }
    } catch (error) {
      return EngineRegistry.isMissing(error) ? undefined : { kind: "unreadable", path: file }
    }
  }

  private static isMissing(error: unknown): boolean {
    return error instanceof Error && "code" in error && error.code === "ENOENT"
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
