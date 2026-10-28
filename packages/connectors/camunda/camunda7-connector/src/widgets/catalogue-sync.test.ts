import { describe, expect, it } from "vitest"
import { catalogueSyncIssues } from "@miragon/pulse-widget-shell/server"
import { definition } from "../definition.js"
import { camunda7Widgets } from "./index.js"

/** Invariant 3, links 1↔2. */
describe("widget catalogue ↔ registry sync", () => {
  it("definition.widgets matches the registered widget components exactly", () => {
    expect(catalogueSyncIssues(definition, camunda7Widgets)).toEqual([])
  })
})
