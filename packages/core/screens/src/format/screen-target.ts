export type ScreenTarget =
  | { readonly kind: "engine"; readonly engine: string }
  | { readonly kind: "process"; readonly engine: string; readonly bpmnProcessId: string }
