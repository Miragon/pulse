// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { LocaleProvider, queryClient, ToastProvider } from "@miragon/mcp-toolkit-ui"
import { WidgetFixtureHost } from "@miragon/mcp-toolkit-ui/app"
import { ANALYTICS_SAVE_SETTINGS, ANALYTICS_SETTINGS_DATA } from "../tool-names.js"
import { AnalyticsSettingsWidget, parseMinBucketSize } from "./settings-section.js"

/** A failed feed says the SETTINGS could not be loaded, not the figures. */

beforeAll(() => {
  // One attempt: the error state is what this suite reads, not the retries.
  queryClient.setQueryDefaults(["analytics:settings"], { retry: false })
})
afterEach(() => {
  cleanup()
  queryClient.clear()
})

const Section = () => <AnalyticsSettingsWidget />

function renderIn(language: "de" | "en") {
  return render(
    <LocaleProvider locale={language}>
      <WidgetFixtureHost
        widget={Section}
        tools={{
          [ANALYTICS_SETTINGS_DATA]: () => {
            throw new Error("profile store unavailable")
          },
        }}
      />
    </LocaleProvider>,
  )
}

describe("the analytics settings section when its feed fails", () => {
  it("says the settings could not be loaded, and what you can do (de)", async () => {
    renderIn("de")
    expect(
      await screen.findByRole("heading", {
        name: "Die Einstellungen konnten nicht geladen werden.",
      }),
    ).toBeTruthy()
    expect(
      screen.getByText("Versuch es noch mal. Klappt es wieder nicht, frag im Chat nach."),
    ).toBeTruthy()
    expect(screen.getByText("profile store unavailable").closest("details")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Erneut versuchen" })).toBeTruthy()
    expect(screen.queryByText(/Kennzahlen/)).toBeNull()
  })

  it("says the same in English", async () => {
    renderIn("en")
    expect(
      await screen.findByRole("heading", { name: "Could not load the settings." }),
    ).toBeTruthy()
    expect(screen.getByText("Try again. If it fails again, ask in the chat.")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy()
    expect(screen.queryByText(/figures/)).toBeNull()
  })
})

describe("the analytics settings section when it saves (U9: a save is never silent)", () => {
  const VIEW = { settings: { defaultPeriod: "7d", minBucketSize: 5 }, canSave: true }

  function renderSaving(save: () => unknown) {
    return render(
      <LocaleProvider locale="en">
        <ToastProvider>
          <WidgetFixtureHost
            widget={Section}
            tools={{ [ANALYTICS_SETTINGS_DATA]: () => VIEW, [ANALYTICS_SAVE_SETTINGS]: save }}
          />
        </ToastProvider>
      </LocaleProvider>,
    )
  }

  const toast = () => document.querySelector(`[data-slot="toast"]`)

  it("confirms the save in a toast — the polite live region a screen reader hears", async () => {
    renderSaving(() => ({ success: true }))
    fireEvent.click(await screen.findByRole("button", { name: "Save" }))
    await waitFor(() => expect(toast()?.textContent).toContain("Settings saved"))
    expect(toast()?.getAttribute("data-tone")).toBe("success")
    expect(toast()?.closest(`[aria-live="polite"]`)).toBeTruthy()
  })

  it("says why a save failed, in a danger toast", async () => {
    renderSaving(() => {
      throw new Error("Tool analytics_save_settings not found")
    })
    fireEvent.click(await screen.findByRole("button", { name: "Save" }))
    await waitFor(() => expect(toast()?.textContent).toContain("Couldn't save the settings"))
    expect(toast()?.getAttribute("data-tone")).toBe("danger")
    expect(toast()?.textContent).toContain("This data isn't available on this server.")
  })

  // U25: an entry that is no valid size is said to be wrong, never turned into 1.
  it.each(["abc", "0", "2.5", " ", "-3"])("refuses %j inline and saves nothing", async (entry) => {
    const saves: unknown[] = []
    renderSaving((args?: unknown) => {
      saves.push(args)
      return { success: true }
    })
    const field = await screen.findByRole("textbox", { name: "Minimum size for comparisons" })
    fireEvent.change(field, { target: { value: entry } })
    expect(field.getAttribute("aria-invalid")).toBe("true")
    const error = screen.getByText("Enter a whole number of 1 or more.")
    expect(field.getAttribute("aria-describedby")).toContain(error.closest("[id]")!.id)
    fireEvent.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() => expect(document.activeElement).toBe(field))
    expect(saves).toEqual([])
    expect(toast()).toBeNull()
  })

  it("saves a valid size as the number you typed", async () => {
    const saves: unknown[] = []
    renderSaving((args?: unknown) => {
      saves.push(args)
      return { success: true }
    })
    const field = await screen.findByRole("textbox", { name: "Minimum size for comparisons" })
    fireEvent.change(field, { target: { value: " 25 " } })
    expect(field.getAttribute("aria-invalid")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() => expect(saves).toEqual([{ defaultPeriod: "7d", minBucketSize: 25 }]))
  })
})

describe("the analytics settings section without the right to save (U25)", () => {
  const READ_ONLY = { settings: { defaultPeriod: "7d", minBucketSize: 5 }, canSave: false }

  it("says why first, above the fields it cannot change, and offers no Save (de)", async () => {
    render(
      <LocaleProvider locale="de">
        <WidgetFixtureHost
          widget={Section}
          tools={{ [ANALYTICS_SETTINGS_DATA]: () => READ_ONLY }}
        />
      </LocaleProvider>,
    )
    const notice = await screen.findByText("Nur lesen")
    expect(
      screen.getByText(
        "Diese Verbindung kann keine Einstellungen speichern. Ändern kannst du sie, wenn du dich über eine Verbindung mit dem Analytics-Toolset standard anmeldest.",
      ),
    ).toBeTruthy()
    const field = screen.getByRole("textbox", { name: "Mindestgröße für Vergleiche" })
    expect(field.hasAttribute("disabled")).toBe(true)
    // The reason comes before the fields in reading order.
    expect(notice.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Speichern" })).toBeNull()
    // A notice in the first paint, not an announcement.
    expect(screen.queryByRole("alert")).toBeNull()
  })
})

describe("parseMinBucketSize", () => {
  it("takes a whole number of 1 or more, nothing else", () => {
    expect(parseMinBucketSize("10")).toBe(10)
    expect(parseMinBucketSize(" 3 ")).toBe(3)
    for (const raw of ["", "0", "-1", "1.5", "1e3", "abc", "99999999999999999999"]) {
      expect(parseMinBucketSize(raw), raw).toBeNull()
    }
  })
})
