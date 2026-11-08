import { describe, expect, it } from "vitest"
import { fromWidgetCspMeta, mergeDomainLists, toWidgetCspMeta } from "./view-csp.js"

describe("toWidgetCspMeta and fromWidgetCspMeta", () => {
  const csp = {
    connectDomains: ["https://c"],
    resourceDomains: ["https://r"],
    frameDomains: ["https://f"],
    baseUriDomains: ["https://b"],
  }
  const meta = {
    connect_domains: ["https://c"],
    resource_domains: ["https://r"],
    frame_domains: ["https://f"],
    base_uri_domains: ["https://b"],
  }

  it("spells each list the other way and leaves absent ones out", () => {
    expect(toWidgetCspMeta(csp)).toEqual(meta)
    expect(fromWidgetCspMeta(meta)).toEqual(csp)
    expect(toWidgetCspMeta({})).toEqual({})
    expect(fromWidgetCspMeta(undefined)).toEqual({})
  })
})

describe("mergeDomainLists", () => {
  it("appends each default list to the tool's own, each entry once, and skips empty ones", () => {
    expect(
      mergeDomainLists<Record<string, string[] | undefined>>(
        { a: ["1"], b: ["2"] },
        { a: ["1", "3"], c: ["4"], d: [], e: undefined },
      ),
    ).toEqual({ a: ["1", "3"], b: ["2"], c: ["4"] })
    expect(mergeDomainLists(undefined, { a: ["1"] })).toEqual({ a: ["1"] })
  })
})
