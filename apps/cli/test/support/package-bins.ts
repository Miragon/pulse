/**
 * The package manifest's bins for the tests. The program has two names: `pulse` (CLI_NAME) and
 * its second name, the command up to 0.25. The second name is the package name without its scope,
 * the bin `npx @miragon/pulse-cli` runs, so it comes from there and is spelled in no test.
 */

import { readFileSync } from "node:fs"

export const PACKAGE = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
) as {
  readonly name: string
  readonly bin: Readonly<Record<string, string>>
  readonly files: readonly string[]
}

/** The second name of the program: the package name without its scope. */
export const SECOND_NAME = PACKAGE.name.replace(/^@[^/]+\//, "")
