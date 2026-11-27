import { describe, expect, it } from "vitest"
import { screenUrlOf, viewRouteOf } from "../src/router/routes.js"
import { processArgsOf, screenProcessOf } from "../src/screens/process/screen-process.js"
import { targetUrl } from "../src/screens/slots.js"

/**
 * A process is a key in one tenant (owner decision 2026-11-26, F17): its address names the tenant
 * as `?tenant=` only where it has one, so a process without a tenant keeps its address; a link of a
 * screen to a process or one of its versions carries the tenant the screen's data names, and the
 * process screen reads its feed by key and tenant.
 */

const E = "prod-a"
const RUNNING = { scope: "running" } as const

const route = (url: string) => {
  const { pathname, search } = new URL(url, "http://localhost")
  return viewRouteOf({ pathname, search })
}

describe("a process's address with its tenant", () => {
  it("names the tenant before the version and reads it back, both ways", () => {
    const url = "/app/engines/prod-a/processes/invoice?tenant=north&version=2&scope=all"
    const shown = route(url)

    expect(shown.screen).toEqual({
      kind: "process",
      engine: E,
      process: "invoice",
      tenantId: "north",
      version: 2,
      filter: { scope: "all" },
    })
    expect(shown.url).toBe(url)
    expect(screenUrlOf(shown.screen!)).toBe(url)
  })

  it("keeps the address of a process without a tenant, an empty tenant read as none", () => {
    expect(route("/app/engines/prod-a/processes/invoice").screen).toEqual({
      kind: "process",
      engine: E,
      process: "invoice",
      filter: RUNNING,
    })
    const empty = route("/app/engines/prod-a/processes/invoice?tenant=")
    expect(empty.screen).not.toHaveProperty("tenantId")
    expect(empty.url).toBe("/app/engines/prod-a/processes/invoice")
  })

  it("escapes a tenant the query cannot hold as it is", () => {
    const url = screenUrlOf({
      kind: "process",
      engine: E,
      process: "invoice",
      tenantId: "north & south",
      filter: RUNNING,
    })

    expect(url).toBe("/app/engines/prod-a/processes/invoice?tenant=north+%26+south")
    expect(route(url).screen).toMatchObject({ tenantId: "north & south" })
  })
})

describe("a screen's link to a process in a tenant", () => {
  it("carries the tenant of the process or the version it opens, none where it has none", () => {
    const process = { kind: "process", engine: E, bpmnProcessId: "label" } as const
    const version = { ...process, kind: "version", version: 3, definitionId: "d3" } as const

    expect(targetUrl({ ...process, tenantId: "north" })).toBe(
      "/app/engines/prod-a/processes/label?tenant=north",
    )
    expect(targetUrl({ ...version, tenantId: "north" })).toBe(
      "/app/engines/prod-a/processes/label?tenant=north&version=3",
    )
    expect(targetUrl(process)).toBe("/app/engines/prod-a/processes/label")
  })
})

describe("the process screen's read of a process in a tenant", () => {
  it("asks the feed for the key and the tenant, none for a process without one", () => {
    const north = screenProcessOf({ process: "label", tenantId: "north" })

    expect(processArgsOf(E, north, 2)).toEqual({
      engine: E,
      process: "label",
      tenantId: "north",
      version: 2,
    })
    expect(processArgsOf(E, screenProcessOf({ process: "label" }), undefined)).toEqual({
      engine: E,
      process: "label",
    })
  })
})
