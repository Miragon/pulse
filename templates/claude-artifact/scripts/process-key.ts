import { readFileSync } from "node:fs"

/**
 * The dashboard's process key as src/app.tsx names it (`export const PROCESS_KEY = "…"`), for the
 * scripts, which run in Node and cannot load the page's TSX.
 */
export function processKeyOf(source: string): string {
  const match = /^export const PROCESS_KEY = "([^"]+)"$/m.exec(source)
  if (match === null) {
    throw new Error('src/app.tsx names no PROCESS_KEY = "<key>": pass --process <key> instead.')
  }
  return match[1]
}

/** The key src/app.tsx names. */
export function pageProcessKey(): string {
  return processKeyOf(readFileSync(new URL("../src/app.tsx", import.meta.url), "utf8"))
}
