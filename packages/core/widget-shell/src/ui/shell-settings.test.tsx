// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { LocaleProvider, queryClient, ToastProvider } from "@miragon/mcp-toolkit-ui"
import { WidgetFixtureHost } from "@miragon/mcp-toolkit-ui/app"
import { SHELL_SAVE_SETTINGS, SHELL_SETTINGS_DATA } from "../shell-settings-contract.js"
import { HostWidgetsProvider } from "./host-widgets.js"
import { SettingsPageWidget, SHELL_SETTINGS_KEY, ShellSettingsWidget } from "./shell-settings.js"

beforeAll(() => {
  queryClient.setQueryDefaults([...SHELL_SETTINGS_KEY], { retry: false })
})
afterEach(() => {
  cleanup()
  queryClient.clear()
})

const Section = () => <ShellSettingsWidget />

function renderSection(tools: Record<string, (args: Record<string, unknown>) => unknown>) {
  return render(
    <LocaleProvider locale="en">
      <ToastProvider>
        <WidgetFixtureHost widget={Section} tools={tools} />
      </ToastProvider>
    </LocaleProvider>,
  )
}

describe("the language section", () => {
  it("saves the chosen language with the shell's save tool and confirms it", async () => {
    const saves: unknown[] = []
    renderSection({
      [SHELL_SETTINGS_DATA]: () => ({ language: "system", canSave: true, readOnlyReason: null }),
      [SHELL_SAVE_SETTINGS]: (args) => {
        saves.push(args)
        return { language: "de", canSave: true, readOnlyReason: null }
      },
    })

    const select = await screen.findByRole<HTMLSelectElement>("combobox", { name: "Language" })
    expect(select.value).toBe("system")
    const save = screen.getByRole<HTMLButtonElement>("button", { name: "Save" })
    expect(save.disabled).toBe(true)

    fireEvent.change(select, { target: { value: "de" } })
    expect(save.disabled).toBe(false)
    fireEvent.click(save)

    await waitFor(() => expect(saves).toEqual([{ language: "de" }]))
    expect(await screen.findByText("Language saved")).toBeTruthy()
  })

  it("names each language in itself and the automatic one in the view's language", async () => {
    renderSection({
      [SHELL_SETTINGS_DATA]: () => ({ language: "en", canSave: true, readOnlyReason: null }),
    })
    const select = await screen.findByRole("combobox", { name: "Language" })
    expect([...select.querySelectorAll("option")].map((o) => o.textContent)).toEqual([
      "Automatic (follows the chat app)",
      "English",
      "Deutsch",
    ])
  })

  it("says why it cannot save on top, with disabled fields and no Save", async () => {
    renderSection({
      [SHELL_SETTINGS_DATA]: () => ({
        language: "system",
        canSave: false,
        readOnlyReason: "noSignIn",
      }),
    })
    expect(await screen.findByText("The language is read-only here")).toBeTruthy()
    expect(screen.getByText(/has no sign-in/)).toBeTruthy()
    expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "Language" }).disabled).toBe(
      true,
    )
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull()
  })

  it("hides itself where the root registers no settings tools", async () => {
    const { container } = renderSection({
      [SHELL_SETTINGS_DATA]: () => {
        throw new Error(`Tool ${SHELL_SETTINGS_DATA} not found`)
      },
    })
    await waitFor(() =>
      expect(queryClient.getQueryState([...SHELL_SETTINGS_KEY, {}])?.status).toBe("error"),
    )
    expect(container.textContent).toBe("")
  })

  it("keeps any other failure visible, with a retry", async () => {
    renderSection({
      [SHELL_SETTINGS_DATA]: () => {
        throw new Error("profile store unavailable")
      },
    })
    expect(await screen.findByRole("button", { name: "Try again" })).toBeTruthy()
  })
})

describe("the settings page", () => {
  const stub = (label: string) => () => <p>{label}</p>

  it("renders its one title, then the shell's section and every module section in the host registry", async () => {
    const widgets = {
      "camunda7:engine-health": stub("engine health"),
      "acme:settings": stub("acme section"),
      "shell:settings": stub("language section"),
      "analytics:settings": stub("analytics section"),
    }
    render(
      <LocaleProvider locale="de">
        <HostWidgetsProvider widgets={widgets}>
          <WidgetFixtureHost widget={() => <SettingsPageWidget />} />
        </HostWidgetsProvider>
      </LocaleProvider>,
    )

    expect(await screen.findByRole("heading", { name: "Einstellungen" })).toBeTruthy()
    expect(screen.getAllByText(/section$/).map((p) => p.textContent)).toEqual([
      "language section",
      "acme section",
      "analytics section",
    ])
    expect(screen.queryByText("engine health")).toBeNull()
  })
})
