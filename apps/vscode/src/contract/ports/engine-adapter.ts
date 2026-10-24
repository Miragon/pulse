import type { DefinitionRef, InstanceSummary } from '../model/read-models.js';
import type { ProcessCommands } from './process-commands.js';
import type { ProcessRuntime } from './process-runtime.js';

export type EngineCredentials =
  | { readonly kind: 'none' }
  | { readonly kind: 'basic'; readonly username: string; readonly password: string };

export interface EngineConnection {
  readonly endpoint: string;
  readonly credentials: EngineCredentials;
}

export interface EngineWebUi {
  readonly name: string;
  overviewUrl(): string;
  instanceUrl(instance: InstanceSummary): string;
  definitionUrl(definition: DefinitionRef): string;
}

export interface EngineAdapter {
  runtime(connection: EngineConnection): ProcessRuntime;
  commands(connection: EngineConnection): ProcessCommands | undefined;
  webUi(webUiUrl: string): EngineWebUi | undefined;
}
