// @vitest-environment happy-dom
import { cleanup, render } from "@testing-library/react"
import { type EngineVerdict, EngineVerdictBadge } from "@miragon/pulse-blocks"
import { LocaleProvider } from "@miragon/pulse-ui"
import { afterEach, describe, expect, it } from "vitest"
import { catalogs } from "../../messages/index.js"

afterEach(cleanup)

/**
 * One word per engine state across the product: the web app's state (the blocks'
 * `EngineVerdictBadge` and the State column, a catalog of the blocks' own) says each state in the
 * words the chat's overview badge and landing row say it in, en and de, the case aside (a badge
 * starts with a capital, the landing's row runs on in lower case).
 */
const STATES: readonly (readonly [
  state: string,
  verdict: EngineVerdict,
  empty: boolean,
  chatKey: string,
])[] = [
  ["ok", "ok", false, "engineHealth.statusStable"],
  ["warning", "warning", false, "engineHealth.statusWarning"],
  ["critical", "critical", false, "engineHealth.statusCritical"],
  ["empty", "ok", true, "engineHealth.statusNothingDeployed"],
  ["unreachable", "unreachable", false, "cockpit.landing.status.unreachable"],
  ["refused", "refused", false, "cockpit.landing.status.refused"],
  ["unauthorized", "unauthorized", false, "cockpit.landing.status.unauthorized"],
  ["forbidden", "forbidden", false, "cockpit.landing.status.forbidden"],
]

/** The word the blocks' badge shows for a state on a host of `locale`. */
function blocksWord(locale: "en" | "de", verdict: EngineVerdict, empty: boolean): string {
  const figures = empty ? { processes: 0, incidents: 0 } : { processes: 2, incidents: 0 }
  const { container } = render(
    <LocaleProvider locale={locale}>
      <EngineVerdictBadge verdict={verdict} figures={figures} />
    </LocaleProvider>,
  )
  const word = container.querySelector("[data-slot=status-badge]")?.textContent ?? ""
  cleanup()
  return word
}

describe("an engine's state in one word on every surface", () => {
  it.each(STATES)("%s", (_, verdict, empty, chatKey) => {
    for (const locale of ["en", "de"] as const) {
      const chat = catalogs[locale][chatKey]
      expect(typeof chat).toBe("string")
      expect(blocksWord(locale, verdict, empty).toLowerCase()).toBe(String(chat).toLowerCase())
    }
  })
})
