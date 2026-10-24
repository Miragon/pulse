import { JsonObject } from './json-object.js';
import type { ProductView } from './views.js';

export class EngineViewParser {
  static product(value: unknown): ProductView {
    const product = JsonObject.of(value, 'telemetry').object('product', 'telemetry product');
    return { name: product.requiredString('name'), version: product.requiredString('version') };
  }

  static version(value: unknown): string {
    return JsonObject.of(value, 'version').requiredString('version');
  }
}
