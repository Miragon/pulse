/** Profiles with auth settings, for the auth resolution tests (src/config/resolve-{auth,bearer}*). */

import type { ProfileAuth, SelectedProfile } from "../../src/config/types.js"

export function profile(auth: ProfileAuth, name = "prod"): SelectedProfile {
  return { name, profile: { auth } }
}

export const NO_PROFILE: SelectedProfile = {}
