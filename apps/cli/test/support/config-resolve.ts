/** A config file with one default profile (the config resolution tests, src/config/resolve*). */

import type { ConfigFile, Profile } from "../../src/config/types.js"

export function file(profile: Profile, name = "p"): ConfigFile {
  return { defaultProfile: name, profiles: { [name]: profile } }
}
