import type { EngineInfo } from "../../../contract/index.js"
import { EngineCliFailure, type EngineClient } from "../engine-cli/index.js"

const GENERIC_PRODUCT = "Camunda 7 REST API"

export class EngineReader {
  constructor(private readonly client: EngineClient) {}

  async describe(): Promise<EngineInfo> {
    return (
      (await this.reportedProduct()) ?? {
        product: GENERIC_PRODUCT,
        version: await this.client.version(),
      }
    )
  }

  private async reportedProduct(): Promise<EngineInfo | undefined> {
    try {
      const product = await this.client.product()
      return { product: product.name, version: product.version }
    } catch (error: unknown) {
      if (this.isNotFound(error)) {
        return undefined
      }
      throw error
    }
  }

  private isNotFound(error: unknown): boolean {
    return error instanceof EngineCliFailure && error.code === "NOT_FOUND"
  }
}
