import {
  FailingRuntime,
  RuntimeError,
  type ProcessCommands,
  type ProcessRuntime,
} from "@miragon/pulse-engine-core"
import type { Dialect } from "@miragon/pulse-profile"
import type {
  BpmnDialect,
  CliTarget,
  EngineAdapter,
  EngineCli,
  EngineConnection,
  EngineCredentials,
  EngineWebUi,
} from "../../ports/index.js"
import type { Credentials, EngineFactories } from "./connection.js"
import type { EngineTarget } from "./engine-target.js"
import { TargetPolicy } from "./target-policy.js"

type EngineAdapters = Readonly<Record<Dialect, EngineAdapter>>

type LocalAdapter = EngineAdapter & { readonly localEndpoint: string }

const NO_CREDENTIALS = { kind: "none" } as const

export class EngineRoot implements EngineFactories {
  private constructor(
    private readonly adapters: EngineAdapters,
    private readonly local: EngineTarget,
  ) {}

  static of<Local extends Dialect>(
    adapters: EngineAdapters & Readonly<Record<Local, LocalAdapter>>,
    { local }: { readonly local: Local },
  ): EngineRoot {
    return new EngineRoot(adapters, {
      name: "local",
      engine: local,
      endpoint: adapters[local].localEndpoint,
      auth: { kind: "none" },
      source: { kind: "default" },
    })
  }

  runtime(target: EngineTarget, credentials: Credentials): ProcessRuntime {
    const refused = TargetPolicy.refusal(target, credentials)
    if (refused !== undefined) {
      return new FailingRuntime(new RuntimeError("misconfigured", refused))
    }
    return this.adapters[target.engine].runtime(this.connectionOf(target, credentials))
  }

  commands(target: EngineTarget, credentials: Credentials): ProcessCommands | undefined {
    return TargetPolicy.refusal(target, credentials) === undefined
      ? this.adapters[target.engine].commands(this.connectionOf(target, credentials))
      : undefined
  }

  canWrite(target: EngineTarget): boolean {
    return (
      this.adapters[target.engine].commands(this.connectionOf(target, NO_CREDENTIALS)) !== undefined
    )
  }

  plans(target: EngineTarget): boolean {
    const runtime = this.adapters[target.engine].runtime(this.connectionOf(target, NO_CREDENTIALS))
    return runtime.checkMigration !== undefined
  }

  webUi(target: EngineTarget): EngineWebUi | undefined {
    return target.webUiUrl === undefined
      ? undefined
      : this.adapters[target.engine].webUi(target.webUiUrl)
  }

  cli(target: EngineTarget, cliTarget: CliTarget): EngineCli | undefined {
    return this.adapters[target.engine].cli(cliTarget)
  }

  localTarget(): EngineTarget {
    return this.local
  }

  dialects(): readonly BpmnDialect[] {
    return Object.values(this.adapters).map((adapter) => adapter.bpmn)
  }

  private connectionOf(target: EngineTarget, credentials: Credentials): EngineConnection {
    return {
      endpoint: target.endpoint,
      credentials: this.engineCredentials(target, credentials),
      ...(target.timeoutMs === undefined ? {} : { timeoutMs: target.timeoutMs }),
    }
  }

  private engineCredentials(target: EngineTarget, credentials: Credentials): EngineCredentials {
    const { auth } = target
    if (auth.kind === "basic" && credentials.kind === "basic") {
      return credentials
    }
    if (auth.kind !== "clientCredentials" || credentials.kind !== "clientCredentials") {
      return NO_CREDENTIALS
    }
    const { tokenEndpoint, audience, scopes } = auth
    return {
      kind: "clientCredentials",
      tokenEndpoint,
      clientId: credentials.clientId,
      clientSecret: credentials.clientSecret,
      ...(audience === undefined ? {} : { audience }),
      ...(scopes === undefined ? {} : { scopes }),
    }
  }
}
