import { describe, expect, it } from "vitest"
import { buildInstanceCockpitUrl, buildProcessCockpitUrl } from "./cockpit-url.js"
import { camunda7Provider, cibsevenProvider, operatonProvider } from "../providers/index.js"

/** Engine link context shorthand: explicit cockpitUrl wins, baseUrl is the derive fallback. */
const cib = (cockpitUrl?: string, baseUrl = "ignored://x") => ({
  baseUrl,
  cockpitUrl,
  provider: cibsevenProvider,
})

describe("buildProcessCockpitUrl (cibseven flavor)", () => {
  it("builds the canonical CIB seven path with version from an explicit cockpit URL", () => {
    expect(
      buildProcessCockpitUrl(cib("http://localhost:8080/webapp"), {
        key: "miraveloLeasing",
        version: 1,
      }),
    ).toBe("http://localhost:8080/webapp/#/seven/auth/process/miraveloLeasing/1")
  })

  it("omits the version segment when version is null (cockpit resolves to latest)", () => {
    expect(
      buildProcessCockpitUrl(cib("http://localhost:8080/webapp"), {
        key: "miraveloLeasing",
        version: null,
      }),
    ).toBe("http://localhost:8080/webapp/#/seven/auth/process/miraveloLeasing")
  })

  it("appends the configured tab as a query parameter", () => {
    expect(
      buildProcessCockpitUrl(
        cib("http://localhost:8080/webapp"),
        { key: "miraveloLeasing", version: 2 },
        { tab: "incidents" },
      ),
    ).toBe("http://localhost:8080/webapp/#/seven/auth/process/miraveloLeasing/2?tab=incidents")
  })

  it("URL-encodes a tab value containing reserved characters", () => {
    expect(
      buildProcessCockpitUrl(
        cib("http://x/webapp"),
        { key: "k", version: 1 },
        { tab: "history & runs" },
      ),
    ).toBe("http://x/webapp/#/seven/auth/process/k/1?tab=history%20%26%20runs")
  })

  it("falls back to deriving the webapp base from baseUrl", () => {
    expect(
      buildProcessCockpitUrl(cib(undefined, "http://localhost:8080/engine-rest"), {
        key: "miraveloLeasing",
        version: 3,
      }),
    ).toBe("http://localhost:8080/webapp/#/seven/auth/process/miraveloLeasing/3")
  })

  it("returns null when baseUrl has no recognisable engine-rest suffix", () => {
    expect(
      buildProcessCockpitUrl(cib(undefined, "http://localhost:8080/api/v1"), {
        key: "k",
        version: 1,
      }),
    ).toBe(null)
  })

  it("rejects non-http(s) cockpit URLs (XSS guard)", () => {
    expect(buildProcessCockpitUrl(cib("javascript:alert(1)"), { key: "k", version: 1 })).toBe(null)
    expect(buildProcessCockpitUrl(cib("ftp://example.com"), { key: "k", version: 1 })).toBe(null)
  })

  it("strips trailing slashes and hashes from a configured base", () => {
    for (const base of ["http://x/webapp/", "http://x/webapp/#", "http://x/webapp/#/"]) {
      expect(buildProcessCockpitUrl(cib(base), { key: "k", version: 1 })).toBe(
        "http://x/webapp/#/seven/auth/process/k/1",
      )
    }
  })

  it("URL-encodes process keys with reserved characters", () => {
    expect(
      buildProcessCockpitUrl(cib("http://localhost:8080/webapp"), {
        key: "tenant:scope/subKey",
        version: 1,
      }),
    ).toBe("http://localhost:8080/webapp/#/seven/auth/process/tenant%3Ascope%2FsubKey/1")
  })

  it("trims whitespace from the configured base", () => {
    expect(buildProcessCockpitUrl(cib("  http://x/webapp  "), { key: "k", version: 1 })).toBe(
      "http://x/webapp/#/seven/auth/process/k/1",
    )
  })
})

describe("buildInstanceCockpitUrl (cibseven flavor)", () => {
  it("builds a process-instance link nested under the process route", () => {
    expect(
      buildInstanceCockpitUrl(cib("http://localhost:8080/webapp"), {
        key: "miraveloLeasing",
        version: 1,
        instanceId: "inst-abc",
      }),
    ).toBe("http://localhost:8080/webapp/#/seven/auth/process/miraveloLeasing/1/inst-abc")
  })

  it("appends the configured tab", () => {
    expect(
      buildInstanceCockpitUrl(
        cib("http://localhost:8080/webapp"),
        { key: "miraveloLeasing", version: 1, instanceId: "inst-abc" },
        { tab: "variables" },
      ),
    ).toBe(
      "http://localhost:8080/webapp/#/seven/auth/process/miraveloLeasing/1/inst-abc?tab=variables",
    )
  })

  it("omits the version segment when version is null (cockpit resolves to latest)", () => {
    expect(
      buildInstanceCockpitUrl(
        cib("http://localhost:8080/webapp"),
        { key: "miraveloLeasing", version: null, instanceId: "inst-abc" },
        { tab: "variables" },
      ),
    ).toBe(
      "http://localhost:8080/webapp/#/seven/auth/process/miraveloLeasing/inst-abc?tab=variables",
    )
  })

  it("falls back to deriving the webapp base from baseUrl", () => {
    expect(
      buildInstanceCockpitUrl(cib(undefined, "http://localhost:8080/engine-rest"), {
        key: "miraveloLeasing",
        version: 2,
        instanceId: "inst-abc",
      }),
    ).toBe("http://localhost:8080/webapp/#/seven/auth/process/miraveloLeasing/2/inst-abc")
  })

  it("URL-encodes both the key and the instance ID", () => {
    expect(
      buildInstanceCockpitUrl(cib("http://localhost:8080/webapp"), {
        key: "tenant:scope/key",
        version: 1,
        instanceId: "inst/with slash",
      }),
    ).toBe(
      "http://localhost:8080/webapp/#/seven/auth/process/tenant%3Ascope%2Fkey/1/inst%2Fwith%20slash",
    )
  })

  it("returns null without an instance id (route needs it)", () => {
    expect(buildInstanceCockpitUrl(cib("http://x/webapp"), { key: "k", version: 1 })).toBe(null)
  })

  it("returns null on non-http(s) bases", () => {
    expect(
      buildInstanceCockpitUrl(cib("javascript:foo"), { key: "k", version: 1, instanceId: "i" }),
    ).toBe(null)
  })
})

describe("classic-cockpit flavors (camunda7 / operaton)", () => {
  const ref = { key: "invoice", version: 3, definitionId: "invoice:3:abc", instanceId: "inst-1" }

  it("camunda7 derives the /camunda webapp base and routes by definition id", () => {
    expect(
      buildProcessCockpitUrl(
        { baseUrl: "http://c7.example/engine-rest", provider: camunda7Provider },
        ref,
      ),
    ).toBe("http://c7.example/camunda/app/cockpit/default/#/process-definition/invoice%3A3%3Aabc")
  })

  it("operaton derives the /operaton webapp base and routes instances by id", () => {
    expect(
      buildInstanceCockpitUrl(
        { baseUrl: "http://op.example/engine-rest", provider: operatonProvider },
        ref,
      ),
    ).toBe("http://op.example/operaton/app/cockpit/default/#/process-instance/inst-1")
  })

  it("an explicit cockpitUrl gets the FLAVOR's route appended (not the CIB Seven one)", () => {
    expect(
      buildProcessCockpitUrl(
        {
          baseUrl: "ignored://x",
          cockpitUrl: "https://ops.example/operaton/app/cockpit/default",
          provider: operatonProvider,
        },
        ref,
      ),
    ).toBe(
      "https://ops.example/operaton/app/cockpit/default/#/process-definition/invoice%3A3%3Aabc",
    )
  })

  it("returns null when the classic route's required id is missing (graceful degradation)", () => {
    expect(
      buildProcessCockpitUrl(
        { baseUrl: "http://c7.example/engine-rest", provider: camunda7Provider },
        { key: "invoice", version: 3 },
      ),
    ).toBe(null)
    expect(
      buildInstanceCockpitUrl(
        { baseUrl: "http://c7.example/engine-rest", provider: camunda7Provider },
        { key: "invoice", version: 3, definitionId: "invoice:3:abc" },
      ),
    ).toBe(null)
  })

  it("ignores the tab option (classic cockpit has no tab deep links)", () => {
    expect(
      buildProcessCockpitUrl(
        { baseUrl: "http://c7.example/engine-rest", provider: camunda7Provider },
        ref,
        { tab: "incidents" },
      ),
    ).toBe("http://c7.example/camunda/app/cockpit/default/#/process-definition/invoice%3A3%3Aabc")
  })
})
