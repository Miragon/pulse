export type C8WorldValue = string | number | null | { readonly date: string }

export interface C8WorldDeployment<Alias extends string = string> {
  readonly alias: Alias
  readonly process: string
  readonly version: number
}

export interface C8WorldInstance<
  Alias extends string = string,
  Deployment extends string = string,
> {
  readonly businessKey: Alias
  readonly deployment: Deployment
  readonly variables: Readonly<Record<string, C8WorldValue>>
}

export interface C8WorldPlan<Deployment extends string, Instance extends string> {
  readonly deployments: readonly C8WorldDeployment<Deployment>[]
  readonly instances: readonly C8WorldInstance<Instance, Deployment>[]
  readonly localVariable: {
    readonly instance: NoInfer<Instance>
    readonly elementId: string
    readonly name: string
    readonly value: string
  }
  readonly diagrams: Readonly<Record<string, string>>
}

export interface C8UnknownIds {
  readonly definitionId: string
  readonly instanceId: string
  readonly incidentId: string
  readonly bulkOperationId: string
}

export interface C8SeededWorld<Deployment extends string, Instance extends string> {
  readonly definitionIds: Readonly<Record<Deployment, string>>
  readonly instanceIds: Readonly<Record<Instance, string>>
  readonly unknown: C8UnknownIds
}

export interface C8SeedRequest {
  readonly method: "POST" | "PUT"
  readonly headers: Readonly<Record<string, string>>
  readonly body: string
}

export interface C8SeedAnswer {
  readonly ok: boolean
  readonly status: number
  text(): Promise<string>
}

export interface C8SeedEngine {
  readonly url: string
  send(url: string, request: C8SeedRequest): Promise<C8SeedAnswer>
  wait(ms: number): Promise<void>
  now(): number
}

export const C8_WORLD = {
  deploymentOrder: ["label@1", "order@1", "order@2", "dispatch@1"],
  failingJobTypes: ["charge-payment", "render-label"],
  workerError: [
    "java.lang.IllegalStateException: the worker failed",
    "\tat io.miragon.shop.Worker.handle(Worker.java:42)",
    "Caused by: java.net.ConnectException: the card gateway is unreachable",
    "\tat io.miragon.shop.Gateway.connect(Gateway.java:7)",
  ].join("\n"),
  openIncidents: 2,
  activeByProcess: {
    "pulse-order": { withoutIncident: 2, withIncident: 1 },
    "pulse-dispatch": { withoutIncident: 0, withIncident: 1 },
    "pulse-label": { withoutIncident: 0, withIncident: 1 },
  },
  unknown: {
    definitionId: "9007199254740991",
    instanceId: "9007199254740990",
    incidentId: "9007199254740989",
    bulkOperationId: "9007199254740988",
  },
  settledWithinMs: 120_000,
  pollIntervalMs: 250,
} as const satisfies {
  readonly deploymentOrder: readonly string[]
  readonly unknown: C8UnknownIds
} & Record<string, unknown>
