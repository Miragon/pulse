// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { LogText } from "./log-text.js"
import { NativeSelect } from "./native-select.js"
import { RowCard } from "./row-card.js"
import { Section } from "./section.js"
import { SettingsCard, SettingsField, SettingsInput } from "./settings.js"
import { VersionChip } from "./table.js"

/** `brand-gates.test.ts` scans for off-scale sizes; these pin the role each piece takes. */

afterEach(cleanup)

const classes = (el: Element | null) => (el?.getAttribute("class") ?? "").split(/\s+/)

describe("kit type roles", () => {
  it("a Section heading is the section step (21 px / 600), its summary keyboard-visible", () => {
    render(
      <Section title="Variables" count={3}>
        <p>body</p>
      </Section>,
    )
    const heading = screen.getByRole("heading", { level: 3, name: "Variables" })
    expect(classes(heading)).toContain("text-section")
    expect(classes(heading.closest("summary"))).toContain("focus-visible:ring-focus")
  })

  it("a settings card titles as a section; labels are dense, help a caption", () => {
    render(
      <SettingsCard title="Defaults">
        <SettingsField label="Period" help="Used when a view names none.">
          <SettingsInput defaultValue="7d" />
        </SettingsField>
      </SettingsCard>,
    )
    expect(classes(screen.getByRole("heading", { name: "Defaults" }))).toContain("text-section")
    expect(classes(screen.getByText("Period"))).toContain("text-dense")
    expect(classes(screen.getByText("Used when a view names none."))).toContain("text-small")
  })

  it("a settings card heads one step under its section (h3), or under the page title (h2)", () => {
    render(
      <>
        <SettingsCard title="Defaults">
          <p>under a section</p>
        </SettingsCard>
        <SettingsCard title="Language" titleAs="h2">
          <p>under the page title</p>
        </SettingsCard>
      </>,
    )
    expect(screen.getByRole("heading", { level: 3, name: "Defaults" })).toBeTruthy()
    const h2 = screen.getByRole("heading", { level: 2, name: "Language" })
    expect(classes(h2)).toContain("text-section")
  })

  it("form controls take the 3:1 input edge, the dense step and the kit's focus ring", () => {
    render(
      <>
        <SettingsInput aria-label="input" />
        <NativeSelect aria-label="select">
          <option>a</option>
        </NativeSelect>
      </>,
    )
    for (const control of [screen.getByLabelText("input"), screen.getByLabelText("select")]) {
      const c = classes(control)
      expect(c).toContain("border-input")
      expect(c).not.toContain("border-border")
      expect(c).toContain("text-dense")
      expect(c).toContain("focus-visible:ring-focus")
    }
  })

  it("log text, version chips and row-card subtitles are captions (13 px)", () => {
    render(
      <>
        <LogText text="NullPointerException" />
        <VersionChip version={3} />
        <RowCard title="Order" subtitle="v3 · 12 running" />
      </>,
    )
    expect(classes(screen.getByText("NullPointerException"))).toContain("text-small")
    expect(classes(screen.getByText("v3"))).toContain("text-small")
    expect(classes(screen.getByText("v3 · 12 running"))).toContain("text-small")
    expect(classes(screen.getByText("Order"))).toContain("text-dense")
  })
})
