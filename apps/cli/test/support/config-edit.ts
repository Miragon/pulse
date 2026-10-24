/** A copy of a config file, for the config edit tests (src/config/edit*.test.ts). */

import type { ConfigFile } from "../../src/config/types.js"

export function frozen(config: ConfigFile): ConfigFile {
  return structuredClone(config)
}
