import type {
  DefinitionRef,
  InstanceDetail,
  InstanceSummary,
  ProcessCommands,
  ProcessRuntime,
  WaitState,
} from "@miragon/pulse-engine-core"

export type EngineCredentials =
  | { readonly kind: "none" }
  | { readonly kind: "basic"; readonly username: string; readonly password: string }

export interface EngineConnection {
  readonly endpoint: string
  readonly credentials: EngineCredentials
}

export interface EngineWebUi {
  readonly name: string
  overviewUrl(): string
  instanceUrl(instance: InstanceSummary): string
  definitionUrl(definition: DefinitionRef): string
}

export interface EngineCli {
  triggerCommand(detail: InstanceDetail, waitState: WaitState): string | undefined
}

export type CliTarget =
  | { readonly kind: "profile"; readonly name: string; readonly endpoint: string }
  | { readonly kind: "endpoint"; readonly endpoint: string }

export interface EngineAdapter {
  runtime(connection: EngineConnection): ProcessRuntime
  commands(connection: EngineConnection): ProcessCommands | undefined
  webUi(webUiUrl: string): EngineWebUi | undefined
  cli(target: CliTarget): EngineCli | undefined
}
