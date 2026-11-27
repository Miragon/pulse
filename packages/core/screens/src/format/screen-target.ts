export type ScreenTarget =
  | { readonly kind: "engine"; readonly engine: string }
  | {
      readonly kind: "process"
      readonly engine: string
      readonly bpmnProcessId: string
      readonly tenantId?: string
    }
  | {
      readonly kind: "version"
      readonly engine: string
      readonly bpmnProcessId: string
      readonly tenantId?: string
      readonly version: number
      readonly definitionId: string
    }
  | {
      readonly kind: "instance"
      readonly engine: string
      readonly instanceId: string
      readonly incidentId?: string
    }
