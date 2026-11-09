/** Locations of the one spec, its patches and what the generator writes from them. */

export const SPEC_FILE = new URL("../spec/api.json", import.meta.url)
export const PATCH_FILE = new URL("../spec/patches.json", import.meta.url)
/**
 * The spec with its patches applied, which c7-client's SDK generator and the CLI's catalog
 * generator read: written by every `generate`, ignored by git and never shipped.
 */
export const PATCHED_SPEC_FILE = new URL("../spec/patched/api.json", import.meta.url)
export const ROUTES_FILE = new URL("../src/generated/routes.json", import.meta.url)
export const CORE_ROUTES_FILE = new URL("../src/generated/core-routes.json", import.meta.url)
