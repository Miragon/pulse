import type { EngineInfo } from "../../../contract/index.js"
import { EngineRequestError, type EngineClient } from "../engine-rest/index.js"

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
      if (EngineRequestError.statusOf(error) === 404) {
        return undefined
      }
      throw error
    }
  }
}
