import type { ProcessCommands } from '../../contract/index.js';
import {
  DiagramCache,
  LiveSwitch,
  SharedDefinitions,
  type EngineLane,
} from '../../core/index.js';
import type { EngineAccess, Environment } from '../../core/protocol/index.js';
import { LivePolicy } from './live-policy.js';
import { AuditedCommands } from './audited-commands.js';
import type { Connection, Credentials, EngineFactories } from './connection.js';
import { EngineBadges } from './engine-badges.js';
import type { EngineTarget } from './engine-target.js';
import type { WriteAudit } from './write-audit.js';
import { WritePolicy, type WritesSetting } from './write-policy.js';

export interface ConnectionSettings {
  readonly writes: WritesSetting;
  readonly live: unknown;
  readonly lane: EngineLane;
}

interface Writes {
  readonly access: EngineAccess;
  readonly commands?: ProcessCommands;
}

const NO_ADAPTER: EngineAccess = {
  writable: false,
  note: 'Read-only. Pulse cannot change data on this engine yet.',
};

export class ConnectionBuilder {
  constructor(
    private readonly engines: EngineFactories,
    private readonly audit: WriteAudit,
  ) {}

  build(
    target: EngineTarget,
    credentials: Credentials,
    environment: Environment,
    settings: ConnectionSettings,
  ): Connection {
    const runtime = this.engines.runtime(target, credentials);
    const { access, commands } = this.writesOf(target, credentials, environment, settings.writes);
    const webUi = this.engines.webUi(target);
    const identity = ConnectionBuilder.identityOf(target, credentials);
    return {
      target,
      badge: {
        ...EngineBadges.of(target, environment),
        access,
        ...(webUi === undefined ? {} : { webUi: webUi.name }),
      },
      runtime,
      diagrams: new DiagramCache(runtime),
      definitions: new SharedDefinitions(runtime, settings.lane),
      lane: settings.lane,
      live: new LiveSwitch(LivePolicy.settingFor(environment, settings.live)),
      ...(commands === undefined ? {} : { commands }),
      ...(webUi === undefined ? {} : { webUi }),
      ...(identity === undefined ? {} : { identity }),
    };
  }

  private writesOf(
    target: EngineTarget,
    credentials: Credentials,
    environment: Environment,
    writes: WritesSetting,
  ): Writes {
    const access = WritePolicy.access(target, writes, credentials);
    const commands = access.writable ? this.engines.commands(target, credentials) : undefined;
    if (commands === undefined) {
      return { access: access.writable ? NO_ADAPTER : access };
    }
    const signedIn = ConnectionBuilder.identityOf(target, credentials) !== undefined;
    return {
      access,
      commands: new AuditedCommands(commands, { target, environment }, this.audit, signedIn),
    };
  }

  private static identityOf(target: EngineTarget, credentials: Credentials): string | undefined {
    return target.auth.kind === 'basic' && credentials.kind === 'basic'
      ? credentials.username
      : undefined;
  }
}
