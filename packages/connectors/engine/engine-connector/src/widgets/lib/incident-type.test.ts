import { describe, expect, it } from "vitest"
import { translator } from "../../messages/use-t.js"
import { incidentTypeWords } from "./incident-type.js"

const words = (type: string, locale: string) =>
  incidentTypeWords(type, (key, params) => translator(locale, key, params))

/**
 * An incident's type as a person reads it, as the extension's webview words it (its core's
 * `Labels.humanize`): Camunda 7's own types by the catalog in the host's language, the glossary's
 * words, and any other type in words from its code.
 */
describe("incidentTypeWords", () => {
  it.each([
    ["failedJob", "en", "Failed job"],
    ["failedJob", "de", "Fehlgeschlagener Job"],
    ["failedExternalTask", "en", "Failed external task"],
    ["failedExternalTask", "de", "Fehlgeschlagener External Task"],
  ])("words Camunda 7's %s in %s: %s", (type, locale, expected) => {
    expect(words(type, locale)).toBe(expected)
  })

  it.each([
    ["invoiceMismatch", "Invoice mismatch"],
    ["payment_declined", "Payment declined"],
    ["credit-check--failed", "Credit check failed"],
    ["HTTP500Error", "Http500 error"],
    ["retry2Times", "Retry2 times"],
    ["  spaced  ", "Spaced"],
    ["", ""],
  ])("words a custom type %j as %j in every language", (type, expected) => {
    expect(words(type, "en")).toBe(expected)
    expect(words(type, "de")).toBe(expected)
  })

  it("reads no key of the catalog for a type named like an object's own member", () => {
    expect(words("toString", "en")).toBe("To string")
    expect(words("constructor", "de")).toBe("Constructor")
  })
})
