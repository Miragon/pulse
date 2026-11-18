import type { T } from "../../messages/use-t.js"

/** The incident types Camunda 7 raises itself, each worded by the catalog. */
const TYPE_KEYS: Readonly<Record<string, string>> = {
  failedJob: "incident.type.failedJob",
  failedExternalTask: "incident.type.failedExternalTask",
}

/** A code in words, as the extension reads one: `paymentDeclined` reads "Payment declined". */
function wordsOfCode(code: string): string {
  const words = code
    .replace(/[_-]+/g, " ")
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .trim()
    .toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/**
 * An incident's type as a person reads it, as the VS Code webview shows it: Camunda 7's own types
 * by the catalog ("Failed job", "Fehlgeschlagener Job"), a custom type in words from its code. What
 * the model reads keeps the engine's code.
 */
export function incidentTypeWords(type: string, t: T): string {
  return Object.hasOwn(TYPE_KEYS, type) ? t(TYPE_KEYS[type]) : wordsOfCode(type)
}
