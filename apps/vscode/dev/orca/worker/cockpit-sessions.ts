import { BpmnProcessId, DefinitionId, InstanceId } from "../../../src/contract/index.js"
import {
  BulkRuns,
  DefinitionPanel,
  InstancePanel,
  StatePublisher,
  type Panel,
  type PanelContext,
} from "../../../src/core/index.js"
import { MessageGuards } from "../../../src/core/protocol/index.js"
import type { Connection } from "../../../src/host/connections/connection.js"
import type { OrcaWorkerApi } from "orca/worker"
import type { ViewHandle, ViewRequest } from "../protocol.js"
import { OrcaPanelEffects } from "./orca-panel-effects.js"

type Opener = (request: ViewRequest) => void

export class CockpitSessions {
  private readonly sessions = new Map<string, Panel>()
  private readonly bulkRuns = new BulkRuns()

  constructor(
    private readonly orca: OrcaWorkerApi,
    private readonly open: Opener,
  ) {}

  attach(caller: string, handle: ViewHandle, connection: Connection): void {
    this.sessions.get(caller)?.dispose()
    this.sessions.set(caller, CockpitSessions.panelFor(handle, this.contextFor(caller, connection)))
  }

  intent(caller: string, intent: unknown): boolean {
    const panel = this.sessions.get(caller)
    if (panel === undefined) {
      return false
    }
    if (MessageGuards.isWebviewIntent(intent)) {
      panel.handle(intent).catch((error: unknown) => {
        this.orca.log(`intent ${intent.type} failed: ${String(error)}`)
      })
    }
    return true
  }

  private contextFor(caller: string, connection: Connection): PanelContext {
    const publisher = new StatePublisher((message) => {
      this.orca.panels.post("cockpit.state", { message }, { panel: caller })
    })
    return {
      runtime: connection.runtime,
      engine: connection.badge,
      diagrams: connection.diagrams,
      definitions: connection.definitions,
      effects: new OrcaPanelEffects(connection.target.name, this.open, (message) => {
        this.orca.log(message)
      }),
      publish: (state) => {
        publisher.publish(state)
      },
      now: () => new Date(),
      wait: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
      bulkRuns: this.bulkRuns,
    }
  }

  private static panelFor(handle: ViewHandle, context: PanelContext): Panel {
    if (handle.view === "instance") {
      return new InstancePanel(context, InstanceId(handle.instanceId))
    }
    return new DefinitionPanel(context, {
      bpmnProcessId: BpmnProcessId(handle.bpmnProcessId),
      ...(handle.definitionId === undefined
        ? {}
        : { definitionId: DefinitionId(handle.definitionId) }),
    })
  }
}
