import type { EngineEntry, EngineFlavor, EngineProvider } from "../engine-provider.js"
import { cibsevenProvider } from "./cibseven.js"
import { camunda7Provider } from "./camunda7.js"
import { operatonProvider } from "./operaton.js"

export const ENGINE_PROVIDERS: Record<EngineFlavor, EngineProvider> = {
  cibseven: cibsevenProvider,
  operaton: operatonProvider,
  camunda7: camunda7Provider,
}

/** The default vendor: engines without a `flavor` are Camunda 7. */
export const DEFAULT_ENGINE_FLAVOR: EngineFlavor = "camunda7"

/** The throw guards untyped callers: an unknown flavor is a boot error, never a wrong cockpit link. */
export function providerForEntry(entry: Pick<EngineEntry, "id" | "flavor">): EngineProvider {
  const flavor = entry.flavor ?? DEFAULT_ENGINE_FLAVOR
  const provider = ENGINE_PROVIDERS[flavor]
  if (!provider) {
    throw new Error(
      `Unknown engine flavor "${flavor}" for engine "${entry.id}" — expected one of: ${Object.keys(
        ENGINE_PROVIDERS,
      ).join(", ")}`,
    )
  }
  return provider
}

export { cibsevenProvider, camunda7Provider, operatonProvider }
