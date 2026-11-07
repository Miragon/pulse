import type { StateMessage, WebviewIntent } from "../../src/core/protocol/index.js"

interface EngineProblem {
  readonly title: string
  readonly detail: string
  readonly needsCredentials: boolean
}

export interface DefinitionRow {
  readonly bpmnProcessId: string
  readonly label: string
  readonly description: string
  readonly withIncident: number
}

export interface EngineRow {
  readonly name: string
  readonly description: string
  readonly needsLogin: boolean
  readonly problem?: EngineProblem
  readonly definitions: readonly DefinitionRow[]
}

export interface EngineList {
  readonly projectFile: string
  readonly engines: readonly EngineRow[]
  readonly problems: readonly string[]
}

export type ViewHandle =
  | {
      readonly pulse: 1
      readonly engine: string
      readonly view: "definition"
      readonly bpmnProcessId: string
      readonly definitionId?: string
    }
  | {
      readonly pulse: 1
      readonly engine: string
      readonly view: "instance"
      readonly instanceId: string
    }

export type ViewRequest =
  | Omit<Extract<ViewHandle, { view: "definition" }>, "pulse">
  | Omit<Extract<ViewHandle, { view: "instance" }>, "pulse">

declare module "orca" {
  interface PluginRequests {
    "engines.list": { output: EngineList }
    "engines.setProjectFile": { input: { path: string }; output: { ok: boolean } }
    "engines.setCredentials": {
      input: { engine: string; username: string; password: string }
      output: { ok: boolean }
    }
    "views.open": { input: ViewRequest; output: { path: string } }
    "cockpit.attach": { input: { handle: string }; output: { attached: boolean; problem?: string } }
    "cockpit.intent": { input: { intent: WebviewIntent }; output: { known: boolean } }
  }
  interface PluginPanelEvents {
    "cockpit.state": { message: StateMessage }
    "engines.changed": { reason: string }
  }
}
