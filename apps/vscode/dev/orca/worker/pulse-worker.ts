import type { OrcaWorkerApi } from "orca/worker"
import type { EngineList, ViewRequest } from "../protocol.js"
import { CockpitSessions } from "./cockpit-sessions.js"
import { EngineDirectory } from "./engine-directory.js"
import { EngineRows } from "./engine-rows.js"
import { ViewHandles } from "./view-handles.js"

export class PulseWorker {
  private readonly directory: EngineDirectory
  private readonly handles: ViewHandles
  private readonly sessions: CockpitSessions
  private loaded: Promise<void> | undefined

  constructor(private readonly orca: OrcaWorkerApi) {
    this.directory = new EngineDirectory(orca)
    this.handles = new ViewHandles(orca)
    this.sessions = new CockpitSessions(orca, (request) => {
      this.openView(request).catch((error: unknown) => {
        orca.log(`open ${request.view} failed: ${String(error)}`)
      })
    })
  }

  start(): void {
    const { panels } = this.orca
    panels.handle("engines.list", () => this.list())
    panels.handle("engines.setProjectFile", async ({ path }) => {
      await this.orca.settings.set("projectFile", path)
      this.loaded = this.directory.reload()
      return { ok: true }
    })
    panels.handle("engines.setCredentials", ({ engine, username, password }) =>
      this.saveLogin(engine, username, password),
    )
    panels.handle("views.open", async (request) => ({ path: await this.openView(request) }))
    panels.handle("cockpit.attach", ({ handle }, { panel }) => this.attach(panel.id, handle))
    panels.handle("cockpit.intent", ({ intent }, { panel }) => ({
      known: this.sessions.intent(panel.id, intent),
    }))
  }

  private async list(): Promise<EngineList> {
    this.loaded = this.directory.reload()
    await this.loaded
    return {
      projectFile: this.directory.projectFile(),
      engines: await Promise.all(
        this.directory.all().map((connection) => EngineRows.of(connection)),
      ),
      problems: this.directory.configurationProblems(),
    }
  }

  private async saveLogin(
    engine: string,
    username: string,
    password: string,
  ): Promise<{ ok: boolean }> {
    const protection = (await this.orca.host.call("secrets.protection")) as { status: string }
    if (protection.status !== "os-keyring") {
      this.orca.log("Logins are not saved: this machine offers no OS key store to Orca.")
      return { ok: false }
    }
    await this.ready()
    const ok = await this.directory.saveLogin(engine, username, password)
    this.orca.panels.post("engines.changed", { reason: "login" })
    return { ok }
  }

  private async openView(request: ViewRequest): Promise<string> {
    await this.ready()
    return this.handles.open(this.directory.projectFile(), request)
  }

  private async attach(
    caller: string,
    text: string,
  ): Promise<{ attached: boolean; problem?: string }> {
    await this.ready()
    const handle = ViewHandles.parse(text)
    if (handle === undefined) {
      return { attached: false, problem: "This file is not a Pulse view." }
    }
    const connection = this.directory.byName(handle.engine)
    if (connection === undefined) {
      return {
        attached: false,
        problem: `No engine named ${handle.engine} in ${this.directory.projectFile()}.`,
      }
    }
    this.sessions.attach(caller, handle, connection)
    return { attached: true }
  }

  private ready(): Promise<void> {
    this.loaded ??= this.directory.reload()
    return this.loaded
  }
}
