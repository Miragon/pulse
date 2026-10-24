/**
 * The user documentation for the docs tests, as [name, markdown]: the CLI's README and every page
 * of `docs/cli/` at the repository root, found on disk so that a new page is checked without being
 * listed here.
 */

import { readdirSync, readFileSync } from "node:fs"

const PACKAGE_ROOT = new URL("../../", import.meta.url)
const REPO_ROOT = new URL("../../../../", import.meta.url)

function markdown(path: string, root: URL): string {
  return readFileSync(new URL(path, root), "utf8")
}

const DOCS_FILES = readdirSync(new URL("docs/cli/", REPO_ROOT))
  .filter((file) => file.endsWith(".md"))
  .sort()

export const DOC_PAGES: readonly (readonly [string, string])[] = [
  ["apps/cli/README.md", markdown("README.md", PACKAGE_ROOT)],
  ...DOCS_FILES.map(
    (file) => [`docs/cli/${file}`, markdown(`docs/cli/${file}`, REPO_ROOT)] as const,
  ),
]
