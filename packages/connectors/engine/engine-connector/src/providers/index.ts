import type {
  C7EngineEntry,
  C7EngineProvider,
  C7Flavor,
  ContractEngineProvider,
  EngineEntry,
  EngineFlavor,
  EngineProvider,
} from "../engine-provider.js"
import { camunda8Provider } from "./camunda8.js"
import { cibsevenProvider } from "./cibseven.js"
import { camunda7Provider } from "./camunda7.js"
import { operatonProvider } from "./operaton.js"

/** One provider per flavor of the profile format; a Camunda 7 flavor's builds its engines' client. */
export const ENGINE_PROVIDERS: {
  readonly [F in EngineFlavor]: F extends C7Flavor ? C7EngineProvider : ContractEngineProvider
} = {
  cibseven: cibsevenProvider,
  operaton: operatonProvider,
  camunda7: camunda7Provider,
  camunda8: camunda8Provider,
}

/** The default vendor: engines without a `flavor` are Camunda 7. */
export const DEFAULT_ENGINE_FLAVOR = "camunda7" satisfies C7Flavor

/** The throw guards untyped callers: an unknown flavor is a boot error, never a wrong cockpit link. */
export function providerForEntry(entry: Pick<C7EngineEntry, "id" | "flavor">): C7EngineProvider
export function providerForEntry(entry: Pick<EngineEntry, "id" | "flavor">): EngineProvider
export function providerForEntry(entry: Pick<EngineEntry, "id" | "flavor">): EngineProvider {
  const flavor = entry.flavor ?? DEFAULT_ENGINE_FLAVOR
  const provider: EngineProvider | undefined = ENGINE_PROVIDERS[flavor]
  if (!provider) {
    throw new Error(
      `Unknown engine flavor "${flavor}" for engine "${entry.id}". Expected one of: ${Object.keys(
        ENGINE_PROVIDERS,
      ).join(", ")}`,
    )
  }
  return provider
}

export { cibsevenProvider, camunda7Provider, camunda8Provider, operatonProvider }
