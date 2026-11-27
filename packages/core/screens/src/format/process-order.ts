export interface ProcessRank {
  readonly bpmnProcessId: string
  readonly tenantId?: string | null | undefined
  readonly name?: string | undefined
  readonly running: number
  readonly withIncident: number
}

export class ProcessOrder {
  static compare(left: ProcessRank, right: ProcessRank): number {
    return (
      right.withIncident - left.withIncident ||
      right.running - left.running ||
      ProcessOrder.nameOf(left).localeCompare(ProcessOrder.nameOf(right), "en") ||
      left.bpmnProcessId.localeCompare(right.bpmnProcessId, "en") ||
      (left.tenantId ?? "").localeCompare(right.tenantId ?? "", "en")
    )
  }

  private static nameOf(rank: ProcessRank): string {
    return rank.name ?? rank.bpmnProcessId
  }
}
