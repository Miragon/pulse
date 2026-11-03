// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { LocaleProvider } from "../locale/locale-provider.js"
import { createUseT } from "./create-use-t.js"

afterEach(cleanup)

const useT = createUseT((locale, key, params) => `${locale}:${key}:${JSON.stringify(params)}`)

function Probe() {
  const t = useT()
  return <p>{t("title", { n: 2 })}</p>
}

describe("createUseT", () => {
  it("binds a module's translator to the nearest LocaleProvider's locale", () => {
    render(
      <LocaleProvider locale="de">
        <Probe />
      </LocaleProvider>,
    )
    expect(screen.getByText('de:title:{"n":2}')).toBeTruthy()
  })

  it("translates in English outside a provider", () => {
    render(<Probe />)
    expect(screen.getByText('en:title:{"n":2}')).toBeTruthy()
  })
})
