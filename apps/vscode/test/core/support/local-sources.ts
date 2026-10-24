import type {
  BpmnProcessId,
  ElementConfiguration,
  ElementImplementation,
  ModelFile,
  SourceLocation,
} from "../../../src/contract/index.js"
import { vi } from "vitest"
import type { LocalSources } from "../../../src/core/panels/panel-context.js"

export interface LocalWorkspace {
  readonly models?: Readonly<Record<string, string>>
  readonly elements?: Readonly<Record<string, ElementConfiguration>>
  readonly code?: SourceLocation
  readonly failing?: true
}

export const CHARGE_PAYMENT: ElementConfiguration = {
  implementation: { kind: "workerTask", taskType: "charge-payment" },
  inputs: [{ target: "amount", source: "${order.total}" }, { target: "currency" }],
  outputs: [{ target: "paymentId", source: "${receipt.id}" }],
  errors: [
    { code: "CARD_EXPIRED", name: "CardExpired" },
    { code: "DECLINED", name: "DECLINED" },
  ],
}

export const WORKER_CODE: SourceLocation = {
  uri: "file:///shop/src/main/java/ChargePaymentWorker.java",
  line: 12,
}

export class LocalSourcesFixture {
  static of(workspace: LocalWorkspace) {
    const failure = () => Promise.reject(new Error("disk is gone"))
    const modelOf = vi.fn((bpmnProcessId: BpmnProcessId): Promise<ModelFile | undefined> => {
      const xml = workspace.models?.[bpmnProcessId]
      return Promise.resolve(
        xml === undefined
          ? undefined
          : {
              uri: `file:///shop/${bpmnProcessId}.bpmn`,
              fileName: `${bpmnProcessId}.bpmn`,
              bpmnProcessId,
              xml,
            },
      )
    })
    const elementIn = vi.fn((model: ModelFile, elementId: string) => {
      const configuration = workspace.elements?.[elementId]
      return Promise.resolve(
        configuration === undefined
          ? undefined
          : { location: { uri: model.uri, line: 7 }, configuration },
      )
    })
    const locate = vi.fn((implementation: ElementImplementation) =>
      Promise.resolve(implementation.kind === "workerTask" ? workspace.code : undefined),
    )
    const sources: LocalSources = workspace.failing
      ? { models: { modelOf: failure, elementIn: failure }, code: { locate: failure } }
      : { models: { modelOf, elementIn }, code: { locate } }
    return { sources, modelOf, elementIn, locate }
  }
}
