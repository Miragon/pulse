import type { InstanceRow, InstanceStateLabel } from "../../core/protocol/index.js"

type StateCode = "running" | "suspended" | "completed" | "terminated"

export interface ListedInstance {
  readonly id: string
  readonly shortId: string
  readonly state: StateCode
  readonly hasIncident: boolean
  readonly businessKey?: string
  readonly startedAt?: string
  readonly selectable?: true
  readonly selected?: true
}

const STATE_CODES: Readonly<Record<InstanceStateLabel, StateCode>> = {
  Running: "running",
  Suspended: "suspended",
  Completed: "completed",
  Cancelled: "terminated",
}

export class ListedInstances {
  static of(row: InstanceRow): ListedInstance {
    return { ...row, state: STATE_CODES[row.state] }
  }
}
