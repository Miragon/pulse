import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import type { IncidentDetails } from "@miragon/pulse-engine-core"
import type { SourceLocation } from "@miragon/pulse-runtime-view/ports"
import type { InstanceChoice } from "@miragon/pulse-runtime-view/core"
import type { Environment } from "@miragon/pulse-runtime-view/protocol"
import { type Connection, ProjectFile } from "@miragon/pulse-runtime-view/host-kit"
import type { OrcaWorkerApi } from "orca/worker"
import type { Notice, PromptAnswer } from "../protocol.js"
import type { ServiceHost } from "./effects-host.js"
import type { EngineRegistry } from "./engine-registry.js"
import { LocalFiles } from "./local-files.js"
import type { OrcaSettings } from "./orca-settings.js"
import type { OrcaWorkspaces } from "./orca-workspaces.js"
import type { Prompts } from "./prompts.js"
import { ViewHandles } from "./view-handles.js"
import type { WriteConfirmation } from "./write-confirmation.js"

export class WorkerServices implements ServiceHost {
  private focusedRoot: string | undefined

  constructor(
    private readonly orca: OrcaWorkerApi,
    private readonly registry: EngineRegistry,
    private readonly workspaces: OrcaWorkspaces,
    private readonly parts: {
      readonly settings: OrcaSettings
      readonly prompts: Prompts
      readonly confirmation: WriteConfirmation
    },
  ) {}

  get confirmation(): WriteConfirmation {
    return this.parts.confirmation
  }

  async pick(title: string, choices: readonly InstanceChoice[]): Promise<string | undefined> {
    const answer = (await this.parts.prompts.ask({
      kind: "pick",
      title,
      choices: choices.map((choice) => ({
        key: choice.instanceId,
        label: choice.label,
        description: choice.description,
      })),
    })) as Extract<PromptAnswer, { kind: "pick" }> | undefined
    return answer?.key
  }

  notice(notice: Notice): void {
    this.orca.log(notice.text)
    this.orca.panels.post("notices.show", { notice })
  }

  showIncident(engine: string, title: string, details: IncidentDetails): void {
    const extension = details.kind === "stacktrace" ? "log" : "txt"
    void this.root()
      .then((root) =>
        ViewHandles.writeText(root, engine, `${title.replace("…", "")}.${extension}`, details.text),
      )
      .then((file) => this.workspaces.openFile(file))
      .catch((error: unknown) => {
        this.orca.log(`incident details: ${String(error)}`)
      })
  }

  openLocation(location: SourceLocation): void {
    this.workspaces.openFile(fileURLToPath(location.uri)).catch((error: unknown) => {
      this.orca.log(`open ${location.uri}: ${String(error)}`)
    })
  }

  editConnection(): void {
    void this.configure().catch((error: unknown) => {
      this.notice({ tone: "danger", text: `Pulse can't open the project file: ${String(error)}` })
    })
  }

  async configure(): Promise<string> {
    const known = this.registry.projectFiles()[0] ?? this.registry.formerProjectFiles()[0]
    const configured = await this.parts.settings.projectFile()
    const file =
      known ?? (configured === "" ? join(await this.root(), ProjectFile.NAME) : configured)
    await LocalFiles.ensureProjectFile(file)
    await this.workspaces.openFile(file)
    if (known === undefined) {
      await this.registry.reload()
    }
    return file
  }

  askForLogin(connection: Connection): void {
    const engine = connection.target.name
    this.orca.panels.post("engines.login", { engine })
    void this.orca.host
      .call("notifications.show", {
        title: `Sign in to ${engine}`,
        body: "Open the Pulse panel to enter the login.",
      })
      .catch(() => undefined)
  }

  turnOnLiveUpdates(environment: Environment): void {
    void this.parts.settings
      .turnOnLiveUpdates(environment)
      .then(() => this.registry.applyLiveSettings())
      .catch((error: unknown) => {
        this.notice({
          tone: "danger",
          text: `Pulse could not turn on live updates: ${String(error)}`,
        })
      })
  }

  noteWrite(): void {
    this.registry.noteWrite()
  }

  async root(): Promise<string> {
    const projectFile = this.registry.projectFiles()[0]
    if (projectFile !== undefined) {
      return dirname(projectFile)
    }
    const focused = await this.workspaces.focusedWorkspace()
    if (focused === undefined) {
      throw new Error("Open a local workspace in Orca first.")
    }
    return focused.path
  }

  roots(): readonly string[] {
    const files = this.registry.projectFiles()
    if (files.length > 0) {
      return files.map((file) => dirname(file))
    }
    return this.focusedRoot === undefined ? [] : [this.focusedRoot]
  }

  async learnRoots(): Promise<void> {
    this.focusedRoot = (await this.workspaces.focusedWorkspace())?.path
  }
}
