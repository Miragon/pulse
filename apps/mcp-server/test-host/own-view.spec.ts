import { expect, test } from "@playwright/test"
import { OWN_VIEW_FEED, OWN_VIEW_HOST_ENV, OWN_VIEW_TOOL } from "./engines.js"

/**
 * A module's own finished HTML document (the add-widget skill's "A finished HTML view"), behind
 * the minimal SEP-1865 host (see test-host/README.md): the host reads the URI the tool binds, not
 * one under `ui://views/`. The document runs the handshake itself, under its own CSP and without
 * the boot's prelude, and reaches its feed through the host.
 */

interface HostLog {
  toolCalls: { name: string; arguments: Record<string, unknown> }[]
  errors: string[]
}

test("a module's own document renders from the URI its tool binds, under its own CSP", async ({
  page,
}) => {
  const errors: string[] = []
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text())
  })
  page.on("pageerror", (err) => errors.push(err.message))
  const base = process.env[OWN_VIEW_HOST_ENV]
  if (!base)
    throw new Error(`${OWN_VIEW_HOST_ENV} is unset. Run via \`playwright test -c test-host\``)
  const query = new URLSearchParams({
    tool: OWN_VIEW_TOOL,
    args: JSON.stringify({ team: "ops" }),
  })
  await page.goto(`${base}/?${query.toString()}`)
  const app = page.frameLocator("#app")

  await expect(app.getByRole("heading", { name: "Team board of ops" })).toBeVisible({
    timeout: 15_000,
  })
  await expect(app.getByRole("listitem")).toHaveText([
    "Doing: A-1 Invoice import stuck",
    "To do: A-2 Renew the signing key",
    "Done: A-3 Archive last quarter",
  ])
  await expect(app.getByText("Feed answered with 3 cards")).toBeVisible()

  const frame = await app.locator("html").evaluate(() => ({
    prelude: "__pulseViewConfig" in globalThis,
    csp: document.head.firstElementChild?.getAttribute("content") ?? "",
  }))
  expect(frame.prelude).toBe(false)
  expect(frame.csp).toContain("connect-src https://api.example.com")
  // The boot adds nothing to a module's own CSP: a view of the bundle has the server's font origin.
  expect(frame.csp).not.toContain("127.0.0.1")

  const log = await page.evaluate(() => (window as unknown as { __hostLog: HostLog }).__hostLog)
  expect(log.toolCalls).toEqual([{ name: OWN_VIEW_FEED, arguments: {} }])
  expect(log.errors).toEqual([])
  expect(errors).toEqual([])
})
