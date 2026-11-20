import { LocaleProvider, setFormatLocale } from "@miragon/pulse-ui"
import { afterEach, describe, expect, it, vi } from "vitest"
import { page } from "vitest/browser"
import type { EngineView, PanelState } from "../../src/core/protocol/index.js"
import { App } from "../../src/webview/app.js"
import { LabelLocale } from "../../src/webview/format/label-locale.js"
import { HostBridge } from "../../src/webview/host/host-bridge.js"
import { ENGINE_VIEW } from "../../dev/webview/fixtures/engine.js"
import {
  allRoles,
  fakeApi,
  findRole,
  getRole,
  mount,
  nextFrame,
  postState,
  queryPart,
  type Mounted,
} from "./harness.js"

const PHONE = 390

const EMPTY_ENGINE: EngineView = {
  ...ENGINE_VIEW,
  processes: [],
  scopeCounts: { all: 0, withIncident: 0 },
  totals: { processes: 0, running: 0, withIncident: 0 },
}

function ready(view: EngineView): PanelState {
  return { status: "ready", view, refreshing: false }
}

async function shown(locale: string, view: EngineView): Promise<Mounted> {
  await page.viewport(PHONE, 800)
  document.documentElement.dataset.cdTheme = "light"
  document.documentElement.dataset.density = "compact"
  setFormatLocale({ language: locale, locale })
  const root = document.createElement("div")
  root.style.cssText = `position: fixed; inset: 0; width: ${String(PHONE)}px; height: 800px;`
  const mounted = mount(
    <LocaleProvider locale={locale}>
      <App bridge={new HostBridge(fakeApi([]))} />
    </LocaleProvider>,
    root,
  )
  postState(ready(view), 1)
  await findRole(root, "region", { name: "Process list" })
  await nextFrame()
  return mounted
}

function cut(element: Element): string[] {
  return element.scrollWidth > element.clientWidth + 1
    ? [
        `"${element.textContent}" is cut: ${String(element.scrollWidth)} > ${String(element.clientWidth)}`,
      ]
    : []
}

function outside(element: Element): string[] {
  const box = element.getBoundingClientRect()
  return box.left < 0 || box.right > PHONE + 0.5
    ? [
        `"${element.textContent}" leaves the screen: ${String(Math.round(box.left))} to ${String(Math.round(box.right))}`,
      ]
    : []
}

function findings(root: HTMLElement): string[] {
  const region = getRole(root, "region", { name: "Process list" })
  const bar = queryPart(region, "filter-bar")
  const heads = [...region.querySelectorAll('th [data-part="column-label"]')]
  const empty = queryPart(region, "table-empty")
  return [
    ...(heads.length === 4 ? [] : [`${String(heads.length)} column captions, not 4`]),
    ...(document.documentElement.scrollWidth > PHONE ? ["the page scrolls sideways"] : []),
    ...allRoles(region, "radio").flatMap((radio) => [...cut(radio), ...outside(radio)]),
    ...outside(getRole(region, "searchbox")),
    ...[bar?.querySelector('[data-slot="toolbar-summary"]')].flatMap((summary) =>
      summary === null || summary === undefined
        ? ["no summary"]
        : [...cut(summary), ...outside(summary)],
    ),
    ...heads.flatMap((head) => cut(head)),
    ...(empty === null ? [] : [...cut(empty), ...outside(empty)]),
  ]
}

const SCOPES_NAMED: Readonly<Record<string, string>> = {
  de: "Prozesse zeigen",
  en: "Show processes",
}

describe("the fit gate", () => {
  it("flags a word cut short and one that leaves the screen", () => {
    const planted = mount(
      <div>
        <span style={{ display: "block", width: "40px", overflow: "hidden", whiteSpace: "nowrap" }}>
          Neueste Version
        </span>
        <span style={{ position: "fixed", left: "370px", width: "60px" }}>Laufend</span>
      </div>,
    )
    const [short, wide] = [...planted.root.querySelectorAll("span")]

    expect([...cut(short!), ...outside(wide!)]).toEqual([
      expect.stringMatching(/^"Neueste Version" is cut: /),
      expect.stringMatching(/^"Laufend" leaves the screen: 370 to 430$/),
    ])
    planted.unmount()
  })
})

describe("the engine tab's blocks at a phone's width", () => {
  let mounted: Mounted | undefined

  afterEach(() => {
    mounted?.unmount()
    LabelLocale.apply()
  })

  it.each(["de", "en"])(
    "keep every %s word of the bar and the column captions whole at 390 px",
    async (locale) => {
      mounted = await shown(locale, ENGINE_VIEW)

      await vi.waitFor(() => {
        expect(findings(mounted!.root)).toEqual([])
      })
      expect(getRole(mounted.root, "radiogroup").getAttribute("aria-label")).toBe(
        SCOPES_NAMED[locale],
      )
    },
  )

  it.each(["de", "en"])(
    "keep the %s words of an engine without processes whole at 390 px",
    async (locale) => {
      mounted = await shown(locale, EMPTY_ENGINE)

      await vi.waitFor(() => {
        expect(findings(mounted!.root)).toEqual([])
      })
    },
  )
})
