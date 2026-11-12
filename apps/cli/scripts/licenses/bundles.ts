/**
 * The module graphs of the CLI's two bundles as tsdown builds them from their own configs
 * (tsdown.config.ts: the npm package; tsdown.standalone.config.ts: the image and the single
 * executables), with nothing written, and the layout the inventory reads them in.
 */

import { realpathSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { build, type UserConfig } from "tsdown"
import npmBundle from "../../tsdown.config.js"
import standaloneBundle from "../../tsdown.standalone.config.js"
import type { BundleName, Layout } from "./inventory.js"

const CLI_DIR = realpathSync(fileURLToPath(new URL("../..", import.meta.url)))
const REPO_DIR = dirname(dirname(CLI_DIR))

/** The file the CLI's artifacts ship beside its LICENSE. */
export const LICENCES_FILE = join(CLI_DIR, "THIRD_PARTY_LICENSES.txt")

const BUNDLES: Readonly<Record<BundleName, UserConfig>> = {
  npm: npmBundle,
  standalone: standaloneBundle,
}

/** The package.json of the package `name` as the module at `from` resolves it. */
const manifestOf = (name: string, from: string): string =>
  createRequire(from).resolve(`${name}/package.json`)

/** rolldown as tsdown runs it: the bundler that writes its runtime module into a bundle. */
const ROLLDOWN_DIR = dirname(manifestOf("rolldown", manifestOf("tsdown", import.meta.url)))

export const CLI_LAYOUT: Layout = {
  repo: REPO_DIR,
  cli: CLI_DIR,
  virtual: {
    "\0rolldown/runtime.js": {
      dir: ROLLDOWN_DIR,
      holds: "the runtime helpers rolldown, tsdown's bundler, writes into the bundle",
    },
  },
  embedded: {
    // the catalog's summaries and descriptions are the spec's texts (scripts/catalog/)
    "src/generated/catalog.json": {
      dir: join(REPO_DIR, "packages/connectors/c7/c7-core/spec"),
      spec: "api.json",
      licence: "Apache-2.0",
      licenceName: "Apache License 2.0",
      // Apache-2.0 section 4(b): say that they are changed
      holds:
        "the descriptions of the commands and their options (the command catalog), taken from " +
        "its OpenAPI specification and changed by Miragon GmbH: packages/connectors/c7/c7-core/" +
        "spec/patches.json corrects some of them, apps/cli/scripts/catalog replaces some of the " +
        "command summaries",
      source:
        "https://github.com/operaton/operaton (engine-rest/engine-rest-openapi), by way of " +
        "https://github.com/operaton/operaton-mcp (resources/operaton-rest-api.json)",
    },
  },
}

/** The modules one bundle holds code of: tsdown's module graph of it, without empty modules. */
async function modulesOf(config: UserConfig): Promise<string[]> {
  const handle = await build({
    ...config,
    config: false,
    cwd: CLI_DIR,
    write: false,
    clean: false,
    logLevel: "silent",
  })
  const ids = handle.bundles
    .flatMap(({ chunks }) => chunks)
    .flatMap((chunk) =>
      chunk.type === "chunk"
        ? chunk.moduleIds.filter((id) => (chunk.modules[id]?.renderedLength ?? 0) > 0)
        : [],
    )
  await Promise.all(handle.bundles.map((bundle) => bundle[Symbol.asyncDispose]()))
  return ids
}

/** The modules each of the CLI's bundles holds code of. */
export async function bundledModules(): Promise<Record<BundleName, string[]>> {
  return { npm: await modulesOf(BUNDLES.npm), standalone: await modulesOf(BUNDLES.standalone) }
}
