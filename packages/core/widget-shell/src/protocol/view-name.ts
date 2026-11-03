/**
 * One prebuilt bundle serves every view, so each view document names its view in a prelude the
 * server prepends to the bundle (`primeViews`). The view name IS its show tool's name.
 */

/** The global a view document's prelude sets before the bundle runs. */
export const VIEW_NAME_GLOBAL = "__pulseView"

/** `<` and the JS line separators escaped, so a name can never close the inline script. */
function scriptSafe(json: string): string {
  return json
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029")
}

/** `globalThis.__pulseView="<name>";` and a newline: a plain statement ahead of the bundle. */
export function viewPrelude(name: string): string {
  return `globalThis.${VIEW_NAME_GLOBAL}=${scriptSafe(JSON.stringify(name))};\n`
}

/** The prelude's value, or undefined when it is missing or not a non-empty string. */
export function readViewName(): string | undefined {
  const value: unknown = (globalThis as Record<string, unknown>)[VIEW_NAME_GLOBAL]
  return typeof value === "string" && value !== "" ? value : undefined
}
