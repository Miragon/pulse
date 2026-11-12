/**
 * Shared fixtures of the tests of a URL without `--profile` through `run()`
 * (src/cli/url-without-profile.test.ts, src/cli/env-url-without-profile.test.ts): a config file
 * whose default profile holds an engine name, an Authorization and an X-Api-Key header and
 * read-only, the command the editors show for their default engine, and the check that a request
 * carries nothing of such a profile.
 */

import { expect } from "vitest"
import type { RecordedRequest } from "./fake-fetch.js"
import { ENGINE_URL } from "./workflow-engine.js"

export const PROFILE_FILE = JSON.stringify({
  defaultProfile: "orders",
  profiles: {
    orders: {
      url: "https://orders.example.com/engine-rest",
      engine: "orders",
      output: "table",
      headers: { Authorization: "Bearer profile-token", "X-Api-Key": "profile-key" },
      readOnly: true,
    },
    basic: { auth: { type: "basic", username: "demo", passwordEnv: "ORDERS_PASSWORD" } },
  },
})

/** The workflow command of the editors' default engine, without its target options. */
export const ADVANCE = ["advance", "pi-1", "--activity-id", "approve"]

/** Every request went to the given URL, without an engine name and without a profile's header. */
export function expectBare(requests: readonly RecordedRequest[]): void {
  expect(requests.length).toBeGreaterThan(0)
  for (const { url, headers } of requests) {
    expect(url.startsWith(`${ENGINE_URL}/`)).toBe(true)
    expect(url).not.toContain("/engine/")
    expect(headers).not.toHaveProperty("authorization")
    expect(headers).not.toHaveProperty("x-api-key")
  }
}
