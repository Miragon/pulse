import type { ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { ListFooter } from "../components/ListFooter.js"
import {
  LocaleProvider,
  useLocale,
  useUiLocale,
  useUiMessages,
  useTranslate,
  type LocaleContextValue,
} from "./locale-provider.js"
import { UI_MESSAGES } from "./ui-messages.js"

/**
 * The locale contract: `LocaleProvider` sets the locale for everyone, the
 * consumer's `useLocale()`/`useTranslate()` and the kit's own strings and
 * number format alike; outside a provider everything is English and keys echo.
 */

function Probe() {
  const messages = useUiMessages()
  return (
    <p>
      {`locale=${useLocale()} ui=${useUiLocale()} t=${useTranslate()("k")} close=${messages.common.close}`}
    </p>
  )
}

const render = (node: ReactNode) => renderToStaticMarkup(node)

describe("LocaleProvider", () => {
  it("binds the locale, the translate and the kit's strings for its subtree", () => {
    const translator = (locale: string, key: string) => `${locale}:${key}`
    expect(
      render(
        <LocaleProvider locale="de-DE" translator={translator}>
          <Probe />
        </LocaleProvider>,
      ),
    ).toContain(`locale=de-DE ui=de-DE t=de-DE:k close=${UI_MESSAGES.de.common.close}`)
  })

  it("applies a uiMessages override over the shipped catalog", () => {
    expect(
      render(
        <LocaleProvider locale="en" uiMessages={{ common: { close: "Done" } }}>
          <Probe />
        </LocaleProvider>,
      ),
    ).toContain("locale=en ui=en t=k close=Done")
  })

  it("keeps the defaults outside any provider", () => {
    expect(render(<Probe />)).toContain(`locale=en ui=en t=k close=${UI_MESSAGES.en.common.close}`)
  })

  it("formats kit counts in the language of the sentence around them", () => {
    const html = render(
      <LocaleProvider locale="de-DE">
        <ListFooter shown={1200} total={4500} hasMore={false} onLoadMore={() => {}} />
      </LocaleProvider>,
    )
    expect(html).toContain("Zeigt 1.200 von 4.500 Zeilen")
  })
})

describe("LocaleContextValue", () => {
  it("accepts a hand-built value without messages (the field is optional)", () => {
    const value: LocaleContextValue = { locale: "en", t: (key) => key }
    expect(value.messages).toBeUndefined()
  })
})
