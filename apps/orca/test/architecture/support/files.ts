import { join } from "node:path"
import { fileURLToPath } from "node:url"

export const PACKAGE_ROOT = fileURLToPath(new URL("../../../", import.meta.url))

export const REPO_ROOT = join(PACKAGE_ROOT, "..", "..")
