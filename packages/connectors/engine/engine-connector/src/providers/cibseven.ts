import type { EngineProvider } from "../engine-provider.js"
import { tabSuffix } from "../lib/cockpit-url.js"
import { createDialectClient } from "./create-client.js"

/** Addressed by process KEY; an omitted version resolves to latest, a "latest" segment would 404. */
export const cibsevenProvider: EngineProvider = {
  flavor: "cibseven",
  branding: { displayName: "CIB seven" },
  createClient: createDialectClient,
  cockpit: {
    deriveWebappBase: (baseUrl) =>
      baseUrl.endsWith("/engine-rest") ? baseUrl.replace(/\/engine-rest$/, "/webapp") : null,
    processRoute: ({ key, version }, tab) =>
      `/#/seven/auth/process/${encodeURIComponent(key)}${
        version !== null ? `/${version}` : ""
      }${tabSuffix(tab)}`,
    instanceRoute: ({ key, version, instanceId }, tab) =>
      instanceId
        ? `/#/seven/auth/process/${encodeURIComponent(key)}${
            version !== null ? `/${version}` : ""
          }/${encodeURIComponent(instanceId)}${tabSuffix(tab)}`
        : null,
  },
}
