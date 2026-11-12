import type {
  InstanceListFilter,
  StateMessage,
  WebviewIntent,
} from "@miragon/pulse-runtime-view/protocol"

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
  readonly active: boolean
  readonly writable: boolean
  readonly needsLogin: boolean
  readonly problem?: EngineProblem
  readonly definitions: readonly DefinitionRow[]
}

export interface ConfigurationProblem {
  readonly text: string
  readonly tone: "warning" | "danger"
}

export interface EngineList {
  readonly projectFile: string
  readonly engines: readonly EngineRow[]
  readonly problems: readonly ConfigurationProblem[]
}

export interface FileRow {
  readonly path: string
  readonly label: string
  readonly description: string
}

export interface ModelRow extends FileRow {
  readonly bpmnProcessId: string
}

export type ViewSpec =
  | { readonly view: "engine" }
  | {
      readonly view: "definition"
      readonly bpmnProcessId: string
      readonly definitionId?: string
      readonly filter?: InstanceListFilter
    }
  | { readonly view: "instance"; readonly instanceId: string }
  | { readonly view: "migration"; readonly bpmnProcessId: string }
  | { readonly view: "model"; readonly bpmnProcessId: string; readonly modelPath: string }

export type ViewRequest = { readonly engine: string } & ViewSpec

export type ViewHandle = { readonly pulse: 1 } & ViewRequest

export type FrameAction =
  | { readonly kind: "copy"; readonly text: string; readonly label: string }
  | { readonly kind: "openExternal"; readonly url: string }

export type Prompt =
  | {
      readonly id: string
      readonly kind: "confirm"
      readonly title: string
      readonly facts: readonly string[]
      readonly confirmLabel: string
      readonly typeHost?: string
    }
  | {
      readonly id: string
      readonly kind: "bulk"
      readonly title: string
      readonly facts: readonly string[]
      readonly confirmLabel: string
      readonly countPrompt: string
      readonly count: number
      readonly warning: string
      readonly typeHost?: string
      readonly reason?: { readonly prompt: string; readonly required: boolean }
    }
  | {
      readonly id: string
      readonly kind: "pick"
      readonly title: string
      readonly choices: readonly {
        readonly key: string
        readonly label: string
        readonly description: string
      }[]
    }

export type PromptAnswer =
  | { readonly kind: "confirm"; readonly confirmed: boolean; readonly typedHost?: string }
  | {
      readonly kind: "bulk"
      readonly confirmed: boolean
      readonly typedCount?: string
      readonly typedHost?: string
      readonly reason?: string
    }
  | { readonly kind: "pick"; readonly key?: string }

export interface Notice {
  readonly tone: "success" | "danger" | "neutral"
  readonly text: string
}

export interface FoundInstance {
  readonly instanceId: string
  readonly label: string
  readonly description: string
}

declare module "orca" {
  interface PluginRequests {
    "engines.list": { output: EngineList }
    "engines.watch": { input: { visible: boolean }; output: { again: boolean } }
    "engines.activate": { input: { engine: string }; output: { ok: boolean } }
    "engines.setProjectFile": { input: { path: string }; output: { ok: boolean } }
    "engines.setCredentials": {
      input: { engine: string; username: string; password: string }
      output: { ok: boolean }
    }
    "engines.configure": { output: { path: string } }
    "instances.find": { input: { query: string }; output: { found: readonly FoundInstance[] } }
    "boards.list": { output: { boards: readonly FileRow[] } }
    "boards.create": { input: { title: string }; output: { path: string } }
    "boards.open": { input: { path: string }; output: { ok: boolean } }
    "models.list": { output: { models: readonly ModelRow[] } }
    "prompts.list": { output: { prompts: readonly Prompt[] } }
    "prompts.answer": { input: { id: string; answer: PromptAnswer }; output: { ok: boolean } }
    "views.open": { input: ViewRequest; output: { path: string } }
    "cockpit.attach": { input: { handle: string }; output: { attached: boolean; problem?: string } }
    "cockpit.watch": { input: { visible: boolean }; output: { again: boolean } }
    "cockpit.intent": {
      input: { intent: WebviewIntent }
      output: { known: boolean; actions: readonly FrameAction[] }
    }
    "board.attach": { input: { text: string }; output: { attached: boolean } }
    "board.changed": { input: { text: string }; output: { known: boolean } }
  }
  interface PluginPanelEvents {
    "cockpit.state": { message: StateMessage }
    "engines.changed": { reason: string }
    "engines.login": { engine: string }
    "engines.focus": { key: string }
    "prompts.changed": { count: number }
    "notices.show": { notice: Notice }
  }
}
