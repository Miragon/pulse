import type { CalledInstanceData, CallLinkData } from "@miragon/pulse-screens"
import type { CalledProcess } from "@miragon/pulse-engine-core"
import { CallLinks as ScreenCallLinks, ScreenJson } from "@miragon/pulse-screens/builder"
import type { CallLink } from "../protocol/index.js"
import { Labels } from "./labels.js"

const OPEN_FROM_DEFINITION = "Open called process"
const OPEN_FROM_INSTANCE = "Not called yet: open called process"

export class CallLinks {
  constructor(
    private readonly calls: readonly CallLinkData[],
    private readonly openDefinitionLabel: string,
  ) {}

  static ofDefinition(calledProcesses: readonly CalledProcess[]): CallLinks {
    const links = ScreenJson.callLinks(ScreenCallLinks.of(calledProcesses).links())
    return new CallLinks(links, OPEN_FROM_DEFINITION)
  }

  static ofInstance(calls: readonly CallLinkData[]): CallLinks {
    return new CallLinks(calls, OPEN_FROM_INSTANCE)
  }

  static missingText(bpmnProcessId: string, engineName: string): string {
    return `${bpmnProcessId} isn't deployed on ${engineName}, or you may not have permission to see it`
  }

  links(engineName: string): CallLink[] {
    return this.calls.map((call) => this.linkOf(call, engineName))
  }

  private linkOf(call: CallLinkData, engineName: string): CallLink {
    const { elementId } = call
    switch (call.kind) {
      case "instances":
        return { elementId, label: this.instancesLabel(call.instances) }
      case "definition": {
        const name = call.definition.name ?? call.definition.bpmnProcessId
        return { elementId, label: `${this.openDefinitionLabel} ${name}` }
      }
      case "missing":
        return {
          elementId,
          label: CallLinks.missingText(call.bpmnProcessId, engineName),
          missing: true,
        }
    }
  }

  private instancesLabel(instances: readonly CalledInstanceData[]): string {
    const [first] = instances
    if (instances.length > 1 || first === undefined) {
      return `Choose one of ${Labels.count(instances.length)} called instances`
    }
    return `Open called instance ${first.bpmnProcessId} ${Labels.shortId(first.id)}`
  }
}
