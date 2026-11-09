import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { vi } from "vitest"
import type { PanelCaller } from "orca/worker"
import { CompositionRoot } from "../src/worker/composition-root.js"
import { FakeAdapter } from "./fake-adapter.js"
import { FakeOrca, PULSE_PANEL } from "./fake-orca.js"

export const LOCAL_ENDPOINT = "http://localhost:18090/engine-rest"
export const REMOTE_ENDPOINT = "https://prod-eu.shop.invalid/engine-rest"

export const PROFILES = {
  "shop-dev": {
    url: LOCAL_ENDPOINT,
    cockpitUrl: "http://localhost:18090/camunda/app/cockpit/default/",
  },
  "prod-eu": { url: REMOTE_ENDPOINT, auth: { type: "basic" } },
}

export class WorkerHarness {
  readonly orca = new FakeOrca()
  readonly adapter = new FakeAdapter()

  private constructor(readonly root: string) {
    this.orca.hostAnswers = {
      "workspace.list": {
        workspaces: [{ id: "shop", name: "shop", path: root, branch: "main", hostId: null }],
      },
      "secrets.protection": { status: "os-keyring" },
    }
    vi.spyOn(CompositionRoot, "create").mockReturnValue(this.adapter.root())
  }

  static async empty(): Promise<WorkerHarness> {
    return new WorkerHarness(await mkdtemp(join(tmpdir(), "pulse-orca-")))
  }

  static async withProject(profiles: object = PROFILES): Promise<WorkerHarness> {
    const harness = await WorkerHarness.empty()
    await writeFile(harness.projectFile, JSON.stringify({ profiles }))
    return harness
  }

  static async withFormerProject(profiles: object = PROFILES): Promise<WorkerHarness> {
    const harness = await WorkerHarness.empty()
    await writeFile(harness.formerProjectFile, JSON.stringify({ profiles }))
    return harness
  }

  get projectFile(): string {
    return join(this.root, ".pulse.json")
  }

  get formerProjectFile(): string {
    return join(this.root, ".pulse-cli.json")
  }

  request(name: string, input?: unknown, panel: PanelCaller = PULSE_PANEL): Promise<unknown> {
    return Promise.resolve(this.orca.request(name, input, panel))
  }
}
