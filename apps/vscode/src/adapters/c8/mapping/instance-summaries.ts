import {
  InstanceId,
  IsoTimestamp,
  type InstanceState,
  type InstanceSummary,
} from "../../../contract/index.js"
import { Present, type InstanceView } from "../rest/index.js"
import { DefinitionRefs } from "./definition-refs.js"

const STATES: Readonly<Record<string, InstanceState>> = {
  ACTIVE: "running",
  SUSPENDED: "suspended",
  COMPLETED: "completed",
  TERMINATED: "terminated",
}

export class InstanceSummaries {
  static of(instance: InstanceView): InstanceSummary {
    return {
      id: InstanceId(instance.key),
      definition: DefinitionRefs.ofInstance(instance),
      state: InstanceSummaries.stateOf(instance),
      hasIncident: instance.hasIncident,
      ...Present.fields({
        businessKey: instance.businessId,
        startedAt: InstanceSummaries.timestamp(instance.startedAt),
        endedAt: InstanceSummaries.timestamp(instance.endedAt),
        parentInstanceId:
          instance.parentKey === undefined ? undefined : InstanceId(instance.parentKey),
      }),
    }
  }

  static stateOf(instance: InstanceView): InstanceState {
    return STATES[instance.state] ?? (instance.endedAt === undefined ? "running" : "completed")
  }

  private static timestamp(value: string | undefined): IsoTimestamp | undefined {
    return value === undefined ? undefined : IsoTimestamp(value)
  }
}
