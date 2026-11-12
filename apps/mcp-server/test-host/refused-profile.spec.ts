import { expect, test, type FrameLocator, type Page } from "@playwright/test"
import { HEALTHY_ENGINE, REFUSED_ENGINE, REFUSED_HOST_ENV } from "./engines.js"

/**
 * A profile the server refuses, in the BUILT bundle: the deployment of global-setup.ts runs the
 * stub engine next to a profile whose secret's variable is not set. The landing lists both, the
 * refused one in words as refused, opening it says why in the host's language, at once and once,
 * without Try again (F1: the server refuses at once and keeps refusing, so a retry only held the
 * reason back for 7 s), and `engine_open_cockpit` on it opens the picker instead of failing. The
 * row is clicked as soon as it shows, so "at once" covers the reads the row starts too.
 */

async function openCockpit(
  page: Page,
  args: Record<string, unknown>,
  locale = "en-US",
): Promise<FrameLocator> {
  const base = process.env[REFUSED_HOST_ENV]
  if (!base)
    throw new Error(`${REFUSED_HOST_ENV} is unset. Run via \`playwright test -c test-host\``)
  const query = new URLSearchParams({
    tool: "engine_open_cockpit",
    args: JSON.stringify(args),
    structuredContent: "keep",
    resultDelayMs: "0",
    theme: "light",
    locale,
  })
  await page.goto(`${base}/?${query.toString()}`)
  return page.frameLocator("#app")
}

/** The tools/call requests the view made through the host. */
async function toolCalls(page: Page): Promise<Array<{ name: string; arguments: object }>> {
  return await page.evaluate(
    () =>
      (
        window as unknown as {
          __hostLog: { toolCalls: Array<{ name: string; arguments: object }> }
        }
      ).__hostLog.toolCalls,
  )
}

/** The refused engine's row: its name leads the button's accessible name. */
const refusedRow = (app: FrameLocator) =>
  app.getByRole("button", { name: new RegExp(`^${REFUSED_ENGINE}\\b`) })

test.describe("landing with a refused profile", () => {
  test("lists the refused engine as refused next to the usable one, at once", async ({ page }) => {
    const app = await openCockpit(page, {})
    await expect(app.getByRole("heading", { level: 1, name: "Operations Cockpit" })).toBeVisible({
      timeout: 15_000,
    })
    await expect(
      app.getByRole("button", { name: new RegExp(`^${HEALTHY_ENGINE}\\b`) }),
    ).toBeVisible()
    // The server refuses at once: a retried read would leave the row loading for 7 s.
    await expect(refusedRow(app)).toHaveAccessibleName(/\bprofile refused$/, { timeout: 3_000 })
  })

  /**
   * Opens the refused engine as soon as its row shows, whatever the row says yet: its reason
   * follows within a second, once for the view, never one per section, and its health is read
   * once (a retry would hold it back 1 + 2 + 4 s).
   */
  async function openRefused(page: Page, app: FrameLocator, title: string, retry: string) {
    await refusedRow(app).click({ timeout: 15_000 })
    const reason = app.getByText(title)
    await expect(reason).toHaveCount(1, { timeout: 1_000 })
    await expect(reason).toBeVisible()
    await expect(app.getByRole("button", { name: retry })).toHaveCount(0)
    await expect(reason).toHaveCount(1)
    const reads = (await toolCalls(page)).filter(
      (call) =>
        call.name === "engine_health_data" &&
        (call.arguments as { engine?: unknown }).engine === REFUSED_ENGINE,
    )
    expect(reads).toHaveLength(1)
  }

  test("opening it says why within a second, once, without Try again, in English and German", async ({
    page,
  }) => {
    const app = await openCockpit(page, {})
    await openRefused(
      page,
      app,
      `Engine ${REFUSED_ENGINE} cannot be used: its profile is refused`,
      "Try again",
    )

    const de = await openCockpit(page, {}, "de-DE")
    await openRefused(
      page,
      de,
      `Die Engine ${REFUSED_ENGINE} ist nicht nutzbar: ihr Profil ist abgelehnt`,
      "Erneut versuchen",
    )
  })

  test("engine_open_cockpit on it opens the picker, not a tool error", async ({ page }) => {
    const app = await openCockpit(page, { engine: REFUSED_ENGINE })
    await expect(app.getByRole("heading", { level: 1, name: "Operations Cockpit" })).toBeVisible({
      timeout: 15_000,
    })
    await expect(app.getByLabel("Selected engine")).toHaveCount(0)
  })
})
