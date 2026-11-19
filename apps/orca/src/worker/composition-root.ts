import { homedir } from "node:os"
import { C7Adapter } from "@miragon/pulse-c7-adapter"
import { C8Adapter } from "@miragon/pulse-c8-adapter"
import type { LocalSources } from "@miragon/pulse-runtime-view/core"
import { EngineRoot, UserConfigLocation } from "@miragon/pulse-runtime-view/host-kit"
import { BpmnModelSource, WorkspaceCodeLocator } from "@miragon/pulse-runtime-view/model"
import type { WorkspaceFiles } from "@miragon/pulse-runtime-view/ports"

export class CompositionRoot {
  constructor(readonly engines: EngineRoot) {}

  static create(): CompositionRoot {
    return new CompositionRoot(
      EngineRoot.of({ c7: new C7Adapter(), c8: new C8Adapter() }, { local: "c7" }),
    )
  }

  static userConfig(): UserConfigLocation {
    return new UserConfigLocation(process.env, homedir(), process.platform)
  }

  localSources(files: WorkspaceFiles): LocalSources {
    const dialects = this.engines.dialects()
    return {
      models: new BpmnModelSource(files, dialects),
      code: new WorkspaceCodeLocator(files, dialects),
    }
  }
}
