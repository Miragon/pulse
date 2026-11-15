import { JsonView } from "@miragon/pulse-c7-core/runtime"
import type { ProductView } from "./views.js"

export class EngineViewParser {
  static product(value: unknown): ProductView {
    const product = JsonView.of(value, "telemetry").object("product", "telemetry product")
    return { name: product.requiredString("name"), version: product.requiredString("version") }
  }

  static version(value: unknown): string {
    return JsonView.of(value, "version").requiredString("version")
  }
}
