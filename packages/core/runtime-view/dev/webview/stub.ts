import type { PanelState, WebviewIntent } from "../../src/core/protocol/index.js"
import { FIXTURES, isFixtureName } from "./fixtures/states.js"

interface DevWindow extends Window {
  acquireVsCodeApi?: () => unknown
  pulseIntents?: WebviewIntent[]
}

const THEMES: Readonly<Record<string, readonly [string, string | undefined]>> = {
  light: ["light", undefined],
  dark: ["dark", undefined],
  hc: ["dark", "hoch"],
  "hc-light": ["light", "hoch"],
}

const params = new URLSearchParams(location.search)
const fixtureName = params.get("fixture") ?? "definition"
const fixture: PanelState = isFixtureName(fixtureName) ? FIXTURES[fixtureName] : FIXTURES.definition
const [theme, contrast] = THEMES[params.get("theme") ?? "light"] ?? ["light", undefined]

document.documentElement.dataset.cdTheme = theme
if (contrast !== undefined) {
  document.documentElement.dataset.cdKontrast = contrast
}

const devWindow = window as DevWindow
const intents: WebviewIntent[] = []
devWindow.pulseIntents = intents
let revision = 0
let stored: unknown = undefined

function publish(state: PanelState): void {
  revision += 1
  window.postMessage({ type: "state", revision, state }, "*")
}

function answer(intent: WebviewIntent): void {
  if (intent.type === "ready") {
    publish(fixture)
  }
  if (intent.type === "refresh" && fixture.status === "ready") {
    publish({ ...fixture, refreshing: true })
    window.setTimeout(() => {
      publish(fixture)
    }, 900)
  }
}

devWindow.acquireVsCodeApi = () => ({
  postMessage: (intent: WebviewIntent) => {
    intents.push(intent)
    answer(intent)
  },
  getState: () => stored,
  setState: (state: unknown) => {
    stored = state
  },
})
