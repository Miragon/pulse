/** What the overlay CSS's suite reads of a stylesheet: selector lists, pulse-ui's `dark:` variant. */

/** The media query of the OS's dark mode, where pulse-ui's theme makes a root that names no mode dark. */
export const OS_DARK_MEDIA = "@media (prefers-color-scheme: dark)"

/** Splits a selector list at its top-level commas (not those inside `:is()` or `:not()`). */
export function selectorList(selector: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < selector.length; i++) {
    const c = selector[i]
    if (c === "(") depth++
    else if (c === ")") depth--
    else if (c === "," && depth === 0) {
      parts.push(selector.slice(start, i).trim())
      start = i + 1
    }
  }
  parts.push(selector.slice(start).trim())
  return parts
}

/**
 * The selectors of pulse-ui's `dark:` variant as theme.css writes it, on `element` (its `&`): its
 * own branch (a dark scope, or a dark scope inside a light island) and its branch under a dark OS
 * (a root that names no mode).
 */
export function darkVariantBranches(themeCss: string, element: string): [own: string, os: string] {
  const flat = themeCss
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\s+/g, " ")
    .replace(/\( /g, "(")
    .replace(/ \)/g, ")")
  const variant =
    /@custom-variant dark \{ (&.+?) \{ @slot; \} @media \(prefers-color-scheme: dark\) \{ (&.+?) \{ @slot; \} \} \}/.exec(
      flat,
    )
  if (variant?.[1] === undefined || variant[2] === undefined) {
    throw new Error("theme.css declares no `dark:` variant with a branch under a dark OS")
  }
  return [variant[1].replaceAll("&", element), variant[2].replaceAll("&", element)]
}
