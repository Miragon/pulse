import { join } from "node:path"
import { fileURLToPath } from "node:url"

export const PACKAGE_ROOT = fileURLToPath(new URL("../../../", import.meta.url))

export const REPO_ROOT = join(PACKAGE_ROOT, "..", "..")

export const PLUGIN_SOURCES = join(PACKAGE_ROOT, "src")

export const PARSING_SOURCES_ON_A_BUSY_CI_RUNNER = { timeout: 60_000 }
