import { describe, expect, it } from "vitest"
import { catalogTextFindings } from "@miragon/pulse-ui/testing"
import { SIGNED_OUT_REASONS } from "@miragon/pulse-widget-shell/widgets"
import { catalogs } from "../src/messages/index.js"

describe("the page's words", () => {
  it.each([
    ["English", catalogs.en, "en"],
    ["German", catalogs.de, "de"],
  ] as const)("follow the voice rules in %s", (_, catalog, language) => {
    expect(catalogTextFindings(catalog, { language })).toEqual([])
  })

  it("hold the same keys in both languages", () => {
    expect(Object.keys(catalogs.de).sort()).toEqual(Object.keys(catalogs.en).sort())
  })

  it("word every reason the signed-out page shows", () => {
    for (const reason of SIGNED_OUT_REASONS) {
      expect(Object.keys(catalogs.en)).toEqual(
        expect.arrayContaining([`signedOut.${reason}.title`, `signedOut.${reason}.description`]),
      )
    }
  })
})
