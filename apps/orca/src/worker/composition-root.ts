import { C7Adapter } from "@miragon/pulse-engine-adapter"
import type { LocalSources } from "@miragon/pulse-runtime-view/core"
import { BpmnModelSource, WorkspaceCodeLocator } from "@miragon/pulse-runtime-view/model"
import {
  FailingRuntime,
  RuntimeError,
  type ProcessCommands,
  type ProcessRuntime,
} from "@miragon/pulse-engine-core"
import {
  type EngineAdapter,
  type EngineConnection,
  type EngineCredentials,
  type EngineWebUi,
  type WorkspaceFiles,
} from "@miragon/pulse-runtime-view/ports"
import {
  type Credentials,
  type EngineFactories,
  type EngineKind,
  type EngineTarget,
  TargetPolicy,
} from "@miragon/pulse-runtime-view/host-kit"

type EngineAdapters = Readonly<Record<EngineKind, EngineAdapter>>

export class CompositionRoot implements EngineFactories {
  constructor(private readonly adapters: EngineAdapters) {}

  static create(): CompositionRoot {
    return new CompositionRoot({ c7: new C7Adapter() })
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

  webUi(target: EngineTarget): EngineWebUi | undefined {
    return target.webUiUrl === undefined
      ? undefined
      : this.adapters[target.engine].webUi(target.webUiUrl)
  }

  static localSources(files: WorkspaceFiles): LocalSources {
    return { models: new BpmnModelSource(files), code: new WorkspaceCodeLocator(files) }
  }

  private connectionOf(target: EngineTarget, credentials: Credentials): EngineConnection {
    return {
      endpoint: target.endpoint,
      credentials: this.engineCredentials(target, credentials),
    }
  }

  private engineCredentials(target: EngineTarget, credentials: Credentials): EngineCredentials {
    return target.auth.kind === "basic" && credentials.kind === "basic"
      ? credentials
      : { kind: "none" }
  }
}
