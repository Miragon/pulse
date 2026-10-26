import type { CreateClientConfig } from "./generated/client.gen.js"
import { mergeHeaders } from "./generated/client/index.js"

/**
 * How the engine sees this client in its access logs: the package name and
 * its release. release-please bumps the version on the annotated line (the
 * `generic` entry for this file in `release-please-config.json`'s
 * `extra-files`), in step with `package.json`; `client.test.ts` holds the two
 * equal.
 */
const USER_AGENT = "@miragon/pulse-camunda7-client/0.23.0" // x-release-please-version

/**
 * Runtime client defaults, referenced by the generator config
 * (`runtimeConfigPath` in openapi-ts.config.ts). The generated default client
 * and `createCamunda7Client` both build their configuration through this
 * function, so the runtime behavior always matches the generated SDK types
 * (`throwOnError: true`, `responseStyle: "data"`).
 */
export const createClientConfig: CreateClientConfig = (override) => ({
  throwOnError: true,
  responseStyle: "data",
  ...override,
  headers: mergeHeaders(
    {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": USER_AGENT,
    },
    override?.headers,
  ),
})
