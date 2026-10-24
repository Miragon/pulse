import type { EngineWebUi, ProcessCommands, ProcessRuntime } from '../../contract/index.js';
import type {
  DiagramCache,
  EngineLane,
  LiveSwitch,
  SharedDefinitions,
} from '../../core/index.js';
import type { EngineBadge } from '../../core/protocol/index.js';
import type { EngineTarget } from './engine-target.js';

export type Credentials =
  | { readonly kind: 'none' }
  | { readonly kind: 'basic'; readonly username: string; readonly password: string }
  | { readonly kind: 'savedForAnotherEndpoint'; readonly savedFor: string };

export interface Connection {
  readonly target: EngineTarget;
  readonly badge: EngineBadge;
  readonly runtime: ProcessRuntime;
  readonly diagrams: DiagramCache;
  readonly definitions: SharedDefinitions;
  readonly lane: EngineLane;
  readonly live: LiveSwitch;
  readonly commands?: ProcessCommands;
  readonly identity?: string;
  readonly webUi?: EngineWebUi;
}

export interface EngineFactories {
  runtime(target: EngineTarget, credentials: Credentials): ProcessRuntime;
  commands(target: EngineTarget, credentials: Credentials): ProcessCommands | undefined;
  webUi(target: EngineTarget): EngineWebUi | undefined;
}
