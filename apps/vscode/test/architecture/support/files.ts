import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

export const APP_ROOT = fileURLToPath(new URL("../../../", import.meta.url))

export const REPO_ROOT = join(APP_ROOT, "..", "..")

export const PARSING_SOURCES_ON_A_BUSY_CI_RUNNER = { timeout: 60_000 }

export function readRepoFile(path: string): string {
  return readFileSync(join(REPO_ROOT, path), "utf8")
}
