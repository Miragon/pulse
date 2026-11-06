import { C7Adapter } from "../adapters/c7/index.js"
import { C8Adapter } from "../adapters/c8/index.js"
import type { LocalSources } from "../core/index.js"
import { BpmnModelSource, WorkspaceCodeLocator } from "../model/index.js"
import {
  FailingRuntime,
  RuntimeError,
  type BpmnDialect,
  type EngineAdapter,
  type EngineConnection,
  type EngineCredentials,
  type EngineWebUi,
  type ProcessCommands,
  type ProcessRuntime,
  type WorkspaceFiles,
} from "../contract/index.js"
import type { Credentials, EngineFactories } from "./connections/connection.js"
import { EngineCatalogue } from "./connections/engine-catalogue.js"
import type { EngineTarget } from "./connections/engine-target.js"
import { TargetPolicy } from "./connections/target-policy.js"

export class CompositionRoot implements EngineFactories {
  readonly catalogue: EngineCatalogue

  private readonly adapters: ReadonlyMap<string, EngineAdapter>
  private readonly dialects: readonly BpmnDialect[]

  constructor(adapters: readonly EngineAdapter[]) {
    this.catalogue = new EngineCatalogue(adapters)
    this.adapters = new Map(adapters.map((adapter) => [adapter.id, adapter]))
    this.dialects = adapters.map((adapter) => adapter.bpmn)
  }

  static create(): CompositionRoot {
    return new CompositionRoot([new C7Adapter(), new C8Adapter()])
  }

  runtime(target: EngineTarget, credentials: Credentials): ProcessRuntime {
    const refused = TargetPolicy.refusal(target, credentials)
    if (refused !== undefined) {
      return new FailingRuntime(new RuntimeError("misconfigured", refused))
    }
    return this.adapterOf(target).runtime(this.connectionOf(target, credentials))
  }

  commands(target: EngineTarget, credentials: Credentials): ProcessCommands | undefined {
    return TargetPolicy.refusal(target, credentials) === undefined
      ? this.adapterOf(target).commands(this.connectionOf(target, credentials))
      : undefined
  }

  canWrite(target: EngineTarget): boolean {
    return (
      this.adapterOf(target).commands({
        endpoint: target.endpoint,
        credentials: { kind: "none" },
      }) !== undefined
    )
  }

  webUi(target: EngineTarget): EngineWebUi | undefined {
    return target.webUiUrl === undefined ? undefined : this.adapterOf(target).webUi(target.webUiUrl)
  }

  localSources(files: WorkspaceFiles): LocalSources {
    return {
      models: new BpmnModelSource(files, this.dialects),
      code: new WorkspaceCodeLocator(files, this.dialects),
    }
  }

  private adapterOf(target: EngineTarget): EngineAdapter {
    const adapter = this.adapters.get(target.engine)
    if (adapter === undefined) {
      throw new Error(`No adapter serves the engine ${target.engine}.`)
    }
    return adapter
  }

  private connectionOf(target: EngineTarget, credentials: Credentials): EngineConnection {
    return {
      endpoint: target.endpoint,
      credentials: this.engineCredentials(target, credentials),
    }
  }

  private engineCredentials(target: EngineTarget, credentials: Credentials): EngineCredentials {
    const { auth } = target
    if (auth.kind === "basic" && credentials.kind === "basic") {
      return credentials
    }
    if (auth.kind === "clientCredentials" && credentials.kind === "clientCredentials") {
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
    return { kind: "none" }
  }
}
