import type { ContractEngineProvider } from "../engine-provider.js"

/**
 * Camunda 8 speaks the Orchestration Cluster REST API, which the server reads through the engine
 * contract alone: no client hook, and no link into Operate below its overview, so no web app base
 * is derived from the cluster's `url` and every route is `null`.
 */
export const camunda8Provider: ContractEngineProvider = {
  flavor: "camunda8",
  dialect: "c8",
  branding: { displayName: "Camunda 8" },
  cockpit: {
    deriveWebappBase: () => null,
    processRoute: () => null,
    instanceRoute: () => null,
  },
}
