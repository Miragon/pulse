import { describe, expect, it } from "vitest"
import * as oidc from "./index.js"

/**
 * The published entry, name by name: knip never reports what an entry exports, so a name added
 * or dropped is held here and decided in review. Types are erased at runtime: this locks the
 * runtime names, each with a value.
 */
describe("the /testing/oidc entry", () => {
  it("exports exactly the fake provider and its default client and users", () => {
    expect(Object.keys(oidc).sort()).toEqual([
      "FAKE_OIDC_CLIENT",
      "FAKE_OIDC_USERS",
      "startFakeOidc",
    ])
    for (const [name, value] of Object.entries(oidc)) expect(value, name).toBeDefined()
  })
})
