import { z } from "zod"

/**
 * The rule of the CLI's `validateUrl` and VS Code's `ProfileUrl`: `fetch` throws on credentials
 * with the URL in its message, which a tool error hands to the model. `?` and `#` are read off
 * the text, since `http://a/?` parses to an empty `search`. What does not parse is `z.url`'s.
 */
function isPlainUrl(value: string): boolean {
  const text = value.trim()
  if (!URL.canParse(text)) return true
  const { username, password } = new URL(text)
  return username === "" && password === "" && !/[?#]/.test(text)
}

/** http(s) only: `localhost:8410/engine-rest` parses as a URL whose scheme is `localhost:`. */
export const httpUrl = (what: string, wayOut = "") =>
  z
    .url({ protocol: /^https?$/, error: `Expected an http:// or https:// URL${what}` })
    .refine(isPlainUrl, {
      message: `Must not contain credentials, a query string or a fragment. The value is not shown because it may hold credentials${wayOut}`,
    })
