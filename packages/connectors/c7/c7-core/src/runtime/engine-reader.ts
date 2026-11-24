/**
 * What an engine is (`describeEngine` of the engine contract): the product and version its
 * telemetry names, or, for an engine that serves no telemetry (a 404), the Camunda 7 REST API at the
 * version it reports.
 */

import type { EngineInfo } from "@miragon/pulse-engine-core"
import type { EnginePort } from "../port.js"
import { queryInput } from "../requests.js"
import { JsonView } from "../json-view.js"

/** The product of an engine whose telemetry is not served. */
const GENERIC_PRODUCT = "Camunda 7 REST API"
const NO_VALUES = queryInput({})

/** Reads what an engine is over its port. */
export class EngineReader {
  constructor(private readonly port: EnginePort) {}

  /** The engine's product and version. */
  async describe(): Promise<EngineInfo> {
    return (
      (await this.reportedProduct()) ?? {
        product: GENERIC_PRODUCT,
        version: await this.apiVersion(),
      }
    )
  }

  private async reportedProduct(): Promise<EngineInfo | undefined> {
    let telemetry: unknown
    try {
      telemetry = await this.port.json("getTelemetryData", NO_VALUES)
    } catch (error: unknown) {
      if (this.port.failure(error)?.status === 404) return undefined
      throw error
    }
    const product = JsonView.of(telemetry, "telemetry").object("product", "telemetry product")
    return { product: product.requiredString("name"), version: product.requiredString("version") }
  }

  private async apiVersion(): Promise<string> {
    const answer = await this.port.json("getRestAPIVersion", NO_VALUES)
    return JsonView.of(answer, "version").requiredString("version")
  }
}
