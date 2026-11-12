import type { ProcessCommands } from "@miragon/pulse-engine-core"
import { DiagramCache, LiveSwitch, SharedDefinitions, type EngineLane } from "../../core/index.js"
import type { EngineAccess, Environment } from "../../core/protocol/index.js"
import { LivePolicy } from "./live-policy.js"
import { AuditedCommands } from "./audited-commands.js"
import type { Connection, Credentials, EngineFactories } from "./connection.js"
import { EngineBadges } from "./engine-badges.js"
import type { EngineTarget } from "./engine-target.js"
import { TargetPolicy } from "./target-policy.js"
import type { WriteAudit } from "./write-audit.js"
import { WritePolicy, type WritesSetting } from "./write-policy.js"
import type { WritesWording } from "./writes-wording.js"

export interface ConnectionSettings {
  readonly writes: WritesSetting
  readonly live: unknown
  readonly lane: EngineLane
}

interface Writes {
  readonly access: EngineAccess
  readonly commands?: ProcessCommands
}

const NO_ADAPTER = "Pulse does not change data on this engine."

export class ConnectionBuilder {
  constructor(
    private readonly engines: EngineFactories,
    private readonly audit: WriteAudit,
    private readonly wording: WritesWording,
  ) {}

  build(
    target: EngineTarget,
    credentials: Credentials,
    environment: Environment,
    settings: ConnectionSettings,
  ): Connection {
    const runtime = this.engines.runtime(target, credentials)
    const { access, commands } = this.writesOf(target, credentials, environment, settings.writes)
    const webUi = this.engines.webUi(target)
    const cli = this.engines.cli(target, ConnectionBuilder.profileOf(target))
    const identity = ConnectionBuilder.identityOf(target, credentials)
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
      ...(cli === undefined ? {} : { cli }),
      ...(identity === undefined ? {} : { identity }),
    }
  }

  private writesOf(
    target: EngineTarget,
    credentials: Credentials,
    environment: Environment,
    writes: WritesSetting,
  ): Writes {
    const access = WritePolicy.access(target, writes, credentials, this.wording)
    const commands = access.writable ? this.engines.commands(target, credentials) : undefined
    if (commands === undefined) {
      return {
        access: access.writable ? ConnectionBuilder.withoutCommands(target, credentials) : access,
      }
    }
    const signedIn = ConnectionBuilder.identityOf(target, credentials) !== undefined
    return {
      access,
      commands: new AuditedCommands(commands, { target, environment }, this.audit, signedIn),
    }
  }

  private static withoutCommands(target: EngineTarget, credentials: Credentials): EngineAccess {
    const refusal = TargetPolicy.refusal(target, credentials)
    return { writable: false, note: `Read-only. ${refusal ?? NO_ADAPTER}` }
  }

  private static profileOf(target: EngineTarget): string | undefined {
    return target.source.kind === "file" ? target.name : undefined
  }

  private static identityOf(target: EngineTarget, credentials: Credentials): string | undefined {
    return target.auth.kind === "basic" && credentials.kind === "basic"
      ? credentials.username
      : undefined
  }
}
