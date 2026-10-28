import { describe, expect, it } from "vitest"
import { catalogueSyncIssues } from "@miragon/pulse-widget-shell/server"
import { definition } from "../definition.js"
import { analyticsWidgets } from "./index.js"

describe("analytics widget catalogue ↔ registry sync", () => {
  it("definition.widgets matches the registered widget components exactly", () => {
    expect(catalogueSyncIssues(definition, analyticsWidgets)).toEqual([])
  })
})
