import { isValidElement, type ReactElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { EmptyState } from "./components/EmptyState.js"
import { ErrorState } from "./components/ErrorState.js"
import { ToastViewport } from "./components/Toast.js"
import { LocaleProvider } from "./locale/locale-provider.js"
import { UI_MESSAGES, type UiMessages } from "./locale/ui-messages.js"
import { createToast } from "./lib/toast-model.js"
import { RENDER_CASES } from "./render-cases.js"
import { userFacingTexts } from "./render-scan.js"

/**
 * Render half of the i18n guard (the static half is `no-hardcoded-copy.test.ts`):
 * render every component under the German locale with a MARKED catalog —
 * each catalog string wrapped in ⟦…⟧ — and scan every text node and text
 * attribute. Whatever is neither marked (it came from the catalog) nor a
 * fixture value the case passed in (it came from props) is a hard-coded
 * string that a German user would read in English.
 */

const OPEN = "⟦"
const CLOSE = "⟧"

function marked(messages: UiMessages): UiMessages {
  const mark = (value: unknown): unknown =>
    typeof value === "function"
      ? (...args: unknown[]) => `${OPEN}${(value as (...a: unknown[]) => string)(...args)}${CLOSE}`
      : `${OPEN}${String(value)}${CLOSE}`
  return Object.fromEntries(
    Object.entries(messages).map(([section, entries]) => [
      section,
      Object.fromEntries(
        Object.entries(entries as Record<string, unknown>).map(([k, v]) => [k, mark(v)]),
      ),
    ]),
  ) as unknown as UiMessages
}

const PSEUDO = marked(UI_MESSAGES.de)

/** Every string/number a case hands to the tree through props (its fixtures). */
function fixtureStrings(node: unknown, out = new Set<string>(), seen = new Set<unknown>()) {
  if (typeof node === "string" || typeof node === "number") {
    const text = String(node).trim()
    if (text.length >= 2) out.add(text)
    return out
  }
  if (!node || typeof node !== "object" || seen.has(node)) return out
  seen.add(node)
  if (node instanceof Error) return fixtureStrings(node.message, out, seen)
  if (isValidElement(node)) return fixtureStrings(node.props, out, seen)
  for (const value of Array.isArray(node) ? node : Object.values(node)) {
    fixtureStrings(value, out, seen)
  }
  return out
}

/** Text a German user would read that came neither from the catalog nor from props. */
function leaks(element: ReactElement): string[] {
  const html = renderToStaticMarkup(
    <LocaleProvider locale="de" uiMessages={PSEUDO}>
      {element}
    </LocaleProvider>,
  )
  const fixtures = [...fixtureStrings(element)].sort((a, b) => b.length - a.length)
  const found: string[] = []
  for (const { source, value } of userFacingTexts(html)) {
    let rest = value
    const innermost = /⟦[^⟦⟧]*⟧/g
    while (innermost.test(rest)) rest = rest.replace(innermost, " ")
    rest = rest.replace(/RC:[\w:-]+/g, " ")
    for (const fixture of fixtures) rest = rest.split(fixture).join(" ")
    if (/\p{L}/u.test(rest)) found.push(`${source}: "${value}" → "${rest.trim()}"`)
  }
  return found
}

const noop = (): void => {}
/** The kit chrome no render case reaches: default strings without props. */
const CHROME_CASES: { name: string; render: () => ReactElement }[] = [
  {
    name: "ToastViewport",
    render: () => (
      <ToastViewport
        toasts={[createToast(1, { tone: "success", title: "Job neu eingeplant." })]}
        onDismiss={noop}
      />
    ),
  },
  {
    name: "ErrorState defaults",
    render: () => <ErrorState title="Fehler" details="raw" onRetry={noop} />,
  },
  {
    name: "EmptyState",
    render: () => <EmptyState title="Leer" description="Nichts zu tun." />,
  },
]

describe("no English leaks into a German view", () => {
  it("the marked catalog marks every string (the scan can see catalog text)", () => {
    expect(PSEUDO.listFooter.loadMore).toBe(`⟦${UI_MESSAGES.de.listFooter.loadMore}⟧`)
    expect(PSEUDO.listFooter.showing({ shown: "1", total: "2", noun: "x" })).toBe(
      `⟦${UI_MESSAGES.de.listFooter.showing({ shown: "1", total: "2", noun: "x" })}⟧`,
    )
    expect(Object.keys(PSEUDO).sort()).toEqual(["common", "filterBar", "listFooter", "pills"])
  })

  for (const renderCase of [...RENDER_CASES, ...CHROME_CASES]) {
    it(`${renderCase.name} renders only catalog text and props under de`, () => {
      expect(leaks(renderCase.render())).toEqual([])
    })
  }

  it("catches a hard-coded string (gate self-test)", () => {
    const Leaky = ({ name }: { name: string }) => (
      <button type="button" aria-label="Close">
        {name} Load more
      </button>
    )
    expect(leaks(<Leaky name="Rechnung" />)).toEqual([
      'text: "Rechnung Load more" → "Load more"',
      'aria-label: "Close" → "Close"',
    ])
  })
})
