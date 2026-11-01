// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import {
  SHELL_SAVE_SETTINGS,
  SHELL_SETTINGS_DATA,
  SHELL_SHOW_SETTINGS,
} from "../shell-settings-contract.js"
import { settingsSections } from "./host-widgets.js"
import {
  SettingsPage,
  SHELL_SETTINGS_KEY,
  ShellSettingsWidget,
  shellViews,
} from "./shell-settings.js"
import { createTestQueryClient, TestViewHost, type TestViewHostProps } from "./test-view-host.js"
import type { ViewComponent } from "./views.js"

afterEach(cleanup)

function renderSection(tools: TestViewHostProps["tools"], client = createTestQueryClient()) {
  return render(
    <TestViewHost tools={tools} locale="en" client={client}>
      <ShellSettingsWidget />
    </TestViewHost>,
  )
}

describe("the language section", () => {
  it("saves the chosen language with the shell's save tool and confirms it", async () => {
    const saves: unknown[] = []
    renderSection({
      [SHELL_SETTINGS_DATA]: () => ({ language: "system", canSave: true, readOnlyReason: null }),
      [SHELL_SAVE_SETTINGS]: (args: unknown) => {
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

  it("re-reads the language after a save, so every view switches live", async () => {
    let language = "system"
    const feed = vi.fn(() => ({ language, canSave: true, readOnlyReason: null }))
    renderSection({
      [SHELL_SETTINGS_DATA]: feed,
      [SHELL_SAVE_SETTINGS]: (args: unknown) => {
        language = (args as { language: string }).language
        return { language, canSave: true, readOnlyReason: null }
      },
    })
    const select = await screen.findByRole<HTMLSelectElement>("combobox", { name: "Language" })
    fireEvent.change(select, { target: { value: "de" } })
    fireEvent.click(screen.getByRole("button", { name: "Save" }))

    await waitFor(() => expect(feed).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(select.value).toBe("de"))
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
    const client = createTestQueryClient()
    const { container } = renderSection(
      {
        [SHELL_SETTINGS_DATA]: () => {
          throw new Error(`Tool ${SHELL_SETTINGS_DATA} not found`)
        },
      },
      client,
    )
    await waitFor(() =>
      expect(client.getQueryState([...SHELL_SETTINGS_KEY, {}])?.status).toBe("error"),
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
  const LANGUAGE = { language: "en", canSave: true, readOnlyReason: null }

  it("renders its one title, then the language section and every module section in registration order", async () => {
    const hostWidgets = {
      "analytics:engine-landscape": stub("landscape"),
      "acme:settings": stub("acme section"),
      "analytics:settings": stub("analytics section"),
    }
    render(
      <TestViewHost
        tools={{ [SHELL_SETTINGS_DATA]: LANGUAGE }}
        hostWidgets={hostWidgets}
        locale="de"
      >
        <SettingsPage />
      </TestViewHost>,
    )

    expect(await screen.findByRole("heading", { name: "Einstellungen" })).toBeTruthy()
    await screen.findByRole("combobox", { name: "Sprache" })
    const order = [...document.querySelectorAll("select, p")]
      .map((el) => (el.tagName === "SELECT" ? "language" : el.textContent))
      .filter((text) => text === "language" || text?.endsWith("section"))
    expect(order).toEqual(["language", "acme section", "analytics section"])
    expect(screen.queryByText("landscape")).toBeNull()
  })

  it("isolates a crashing section: the others and the page stay", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    const Broken = () => {
      throw new Error("section bug")
    }
    render(
      <TestViewHost
        tools={{ [SHELL_SETTINGS_DATA]: LANGUAGE }}
        hostWidgets={{ "broken:settings": Broken, "acme:settings": stub("acme section") }}
        locale="en"
      >
        <SettingsPage />
      </TestViewHost>,
    )
    expect(await screen.findByText("This element couldn't be displayed.")).toBeTruthy()
    expect(screen.getByText("acme section")).toBeTruthy()
    expect(screen.getByRole("heading", { name: "Settings" })).toBeTruthy()
    error.mockRestore()
  })

  it("is the shell's one view, under its show tool's name", async () => {
    const View: ViewComponent = shellViews[SHELL_SHOW_SETTINGS]
    render(
      <TestViewHost tools={{ [SHELL_SETTINGS_DATA]: LANGUAGE }} locale="en">
        <View data={LANGUAGE as never} />
      </TestViewHost>,
    )
    expect(await screen.findByRole("heading", { name: "Settings" })).toBeTruthy()
    expect(Object.keys(shellViews)).toEqual([SHELL_SHOW_SETTINGS])
  })
})

describe("settingsSections", () => {
  it("keeps the <module>:settings entries in registration order and nothing else", () => {
    const Widget = () => null
    const sections = settingsSections({
      "camunda7:settings": Widget,
      "analytics:engine-landscape": Widget,
      "analytics:settings": Widget,
      "settings:other": Widget,
    })
    expect(sections.map(([id]) => id)).toEqual(["camunda7:settings", "analytics:settings"])
  })
})
