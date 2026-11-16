import { describe, expect, it } from "vitest"
import { SIGNED_OUT_REASONS } from "@miragon/pulse-widget-shell/widgets"
import { COCKPIT_VIEW, routeOf, signInUrl } from "../src/routes.js"

const at = (url: string) => {
  const { pathname, search } = new URL(url, "http://localhost")
  return routeOf({ pathname, search })
}

describe("routeOf", () => {
  it("opens the cockpit at its default start on /app", () => {
    expect(at("/app")).toEqual({ kind: "view", view: COCKPIT_VIEW, args: {} })
    expect(at("/app?view=jobs")).toEqual({ kind: "view", view: COCKPIT_VIEW, args: {} })
  })

  it("opens the cockpit at the start the query of /app/cockpit names, one argument per parameter", () => {
    expect(at("/app/cockpit?view=process-detail&engine=prod&processDefinitionKey=invoice")).toEqual(
      {
        kind: "view",
        view: COCKPIT_VIEW,
        args: { view: "process-detail", engine: "prod", processDefinitionKey: "invoice" },
      },
    )
    expect(at("/app/cockpit")).toEqual({ kind: "view", view: COCKPIT_VIEW, args: {} })
  })

  it("passes a parameter the cockpit does not take on, for the tool to refuse it", () => {
    expect(at("/app/cockpit?utm_source=mail")).toMatchObject({ args: { utm_source: "mail" } })
  })

  it("reads the cockpit's flag as true or false, and any other value as the text it is", () => {
    const args = (query: string) => {
      const route = at(`/app/cockpit?${query}`)
      return route.kind === "view" ? route.args : undefined
    }
    expect(args("view=jobs&failedOnly=true")).toEqual({ view: "jobs", failedOnly: true })
    expect(args("view=jobs&failedOnly=false")).toEqual({ view: "jobs", failedOnly: false })
    expect(args("view=jobs&failedOnly=yes")).toEqual({ view: "jobs", failedOnly: "yes" })
    expect(args("engine=true")).toEqual({ engine: "true" })
  })

  it("keeps a parameter named like an object's own key as a plain argument", () => {
    const route = at("/app/cockpit?__proto__=x&constructor=y")
    expect(route.kind === "view" && Object.getPrototypeOf(route.args)).toBe(Object.prototype)
    expect(route.kind === "view" && Object.entries(route.args)).toEqual([
      ["__proto__", "x"],
      ["constructor", "y"],
    ])
  })

  it("shows the signed-out page with its reason, a sign-out's where it names none or another", () => {
    for (const reason of SIGNED_OUT_REASONS) {
      expect(at(`/app/signed-out?reason=${reason}`)).toEqual({ kind: "signed-out", reason })
    }
    expect(at("/app/signed-out")).toEqual({ kind: "signed-out", reason: "signed_out" })
    expect(at("/app/signed-out?reason=toString")).toEqual({
      kind: "signed-out",
      reason: "signed_out",
    })
  })
})

describe("signInUrl", () => {
  it("starts a sign-in that comes back to /app without a page to return to", () => {
    expect(signInUrl()).toBe("/app/auth/login")
    expect(signInUrl("/app")).toBe("/app/auth/login")
  })

  it("names the page and its query to come back to", () => {
    expect(signInUrl("/app/cockpit?view=jobs&engine=prod")).toBe(
      "/app/auth/login?return=%2Fapp%2Fcockpit%3Fview%3Djobs%26engine%3Dprod",
    )
  })
})
