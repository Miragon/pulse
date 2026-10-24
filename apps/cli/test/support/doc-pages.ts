/**
 * The user documentation for the docs tests, as [name, markdown]: the README and every page of
 * `docs/`, found on disk so that a new page is checked without being listed here.
 */

import { readdirSync, readFileSync } from "node:fs"

const ROOT = new URL("../../", import.meta.url)

function markdown(path: string): string {
  return readFileSync(new URL(path, ROOT), "utf8")
}

const DOCS_FILES = readdirSync(new URL("docs/", ROOT))
  .filter((file) => file.endsWith(".md"))
  .sort()

export const DOC_PAGES: readonly (readonly [string, string])[] = [
  ["README.md", markdown("README.md")],
  ...DOCS_FILES.map((file) => [`docs/${file}`, markdown(`docs/${file}`)] as const),
]
