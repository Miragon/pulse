import { expect, test, type FrameLocator, type Page } from "@playwright/test"
import { HEALTHY_ENGINE, REFUSED_ENGINE, REFUSED_HOST_ENV } from "./engines.js"

/**
 * A profile the server refuses, in the BUILT bundle: the deployment of global-setup.ts runs the
 * stub engine next to a profile whose secret's variable is not set. The landing lists both, the
 * refused one in words as refused, opening it says why in the host's language, and
 * `engine_open_cockpit` on it opens the picker instead of failing.
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

test.describe("landing with a refused profile", () => {
  test("lists the refused engine as refused next to the usable one", async ({ page }) => {
    const app = await openCockpit(page, {})
    await expect(app.getByRole("heading", { level: 1, name: "Operations Cockpit" })).toBeVisible({
      timeout: 15_000,
    })
    await expect(
      app.getByRole("button", { name: new RegExp(`^${HEALTHY_ENGINE}\\b`) }),
    ).toBeVisible()
    await expect(
      app.getByRole("button", { name: new RegExp(`^${REFUSED_ENGINE}\\b.*\\bprofile refused$`) }),
    ).toBeVisible({ timeout: 15_000 })
  })

  test("opening it says the profile is refused, in English and German", async ({ page }) => {
    const app = await openCockpit(page, {})
    await app
      .getByRole("button", { name: new RegExp(`^${REFUSED_ENGINE}\\b`) })
      .click({ timeout: 15_000 })
    await expect(
      app.getByText(`Engine ${REFUSED_ENGINE} cannot be used: its profile is refused`).first(),
    ).toBeVisible({ timeout: 15_000 })

    const de = await openCockpit(page, {}, "de-DE")
    await de
      .getByRole("button", { name: new RegExp(`^${REFUSED_ENGINE}\\b`) })
      .click({ timeout: 15_000 })
    await expect(
      de
        .getByText(`Die Engine ${REFUSED_ENGINE} ist nicht nutzbar: ihr Profil ist abgelehnt`)
        .first(),
    ).toBeVisible({ timeout: 15_000 })
  })

  test("engine_open_cockpit on it opens the picker, not a tool error", async ({ page }) => {
    const app = await openCockpit(page, { engine: REFUSED_ENGINE })
    await expect(app.getByRole("heading", { level: 1, name: "Operations Cockpit" })).toBeVisible({
      timeout: 15_000,
    })
    await expect(app.getByLabel("Selected engine")).toHaveCount(0)
  })
})
