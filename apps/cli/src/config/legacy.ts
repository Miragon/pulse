/**
 * The names pulse-cli shipped under while it was called operate (released up to 0.10.0): its
 * variables, its config directory, its project file and its command. pulse-cli still reads them,
 * with one warning per run (cli/legacy-notice.ts), until LEGACY_REMOVAL, and legacy.test.ts fails
 * the first release after that date. Only this module spells them, built from LEGACY, so the
 * repository's old-names guard finds no literal here. Removal list: apps/cli/CLAUDE.md, "Names of
 * operate".
 */

import { CLI_NAME } from "../util.js"
import type { Env } from "./pick.js"
import { ENV, ENV_PREFIX } from "./types.js"

/** When operate's names stop working; the warning and the docs say it this way. */
export const LEGACY_REMOVAL = "the first release after 2027-01-31"
/** The docs section that maps each old name to its new one. */
export const LEGACY_DOCS = "https://miragon.github.io/pulse/cli/installation#renamed-from-operate"

const LEGACY = "operate"
/** The command operate (Homebrew keeps it as an alias of pulse-cli). */
export const LEGACY_PROGRAM = LEGACY
/** operate's config directory, read next to CONFIG_DIRECTORY. */
export const LEGACY_CONFIG_DIRECTORY = LEGACY
/** operate's project file, looked up after PROJECT_FILE in each directory. */
export const LEGACY_PROJECT_FILE = `.${LEGACY}.json`
/** The prefix of operate's variables (ENV_PREFIX now). */
export const LEGACY_ENV_PREFIX = `${LEGACY.toUpperCase()}_`

/** The ENV keys operate released (0.10.0); flavor is pulse-cli's own and has no old name. */
const RELEASED = [
  "url",
  "engine",
  "profile",
  "config",
  "output",
  "timeout",
  "auth",
  "username",
  "password",
  "oauthIssuer",
  "oauthAuthorizationEndpoint",
  "oauthTokenEndpoint",
  "oauthClientId",
  "oauthClientSecret",
  "oauthScopes",
  "oauthAudience",
  "oauthRedirectPort",
  "token",
  "tokenCommand",
  "headers",
  "readOnly",
] as const satisfies readonly (keyof typeof ENV)[]

/** One of operate's names a run uses, for the warning. */
export type LegacyUse =
  | { readonly kind: "program" }
  | {
      readonly kind: "variable"
      readonly name: string
      readonly replacement: string
      readonly ignored: boolean
    }
  | { readonly kind: "config-file"; readonly path: string; readonly replacement: string }
  | {
      readonly kind: "project-file"
      readonly path: string
      readonly replacement: string
      readonly shadowedBy?: string
    }

export const LEGACY_PROGRAM_USE: LegacyUse = { kind: "program" }

/** operate's name of a pulse-cli variable: the same suffix under LEGACY_ENV_PREFIX. */
export function legacyVariable(name: string): string {
  return `${LEGACY_ENV_PREFIX}${name.slice(ENV_PREFIX.length)}`
}

const isGiven = (value: string | undefined): boolean => value !== undefined && value.trim() !== ""

/**
 * The environment pulse-cli reads, and which of operate's variables it holds. While none of
 * pulse-cli's variables is set, each of operate's that is set (not blank) reads as its pulse-cli
 * twin. Once one of pulse-cli's is set (blank too), operate's are all ignored: a caller that sets
 * the new names and strips them by prefix never passes on old headers or token commands. Read the
 * view by name only: it keeps every other variable of `raw` (on Windows without case) through its
 * prototype, so never enumerate it.
 */
export function withLegacyEnv(raw: Env): {
  readonly env: Env
  readonly uses: readonly LegacyUse[]
} {
  const ignored = Object.values(ENV).some((name) => raw[name] !== undefined)
  const found = RELEASED.map((key) => ENV[key]).filter((name) => isGiven(raw[legacyVariable(name)]))
  const uses = found.map((replacement): LegacyUse => ({
    kind: "variable",
    name: legacyVariable(replacement),
    replacement,
    ignored,
  }))
  if (ignored || found.length === 0) return { env: raw, uses }
  const env = Object.create(raw) as Record<string, string | undefined>
  for (const name of found) {
    // an own property of the view: raw (on Windows process.env itself) stays as it is
    Object.defineProperty(env, name, { value: raw[legacyVariable(name)] })
  }
  return { env, uses }
}

/** The names a shell may start operate by: a link, an executable, an npm shim, a script. */
const LEGACY_EXTENSIONS = ["", ".exe", ".cmd", ".ps1", ".js", ".cjs", ".mjs"]

/** True when the shell started pulse-cli as operate (process.argv[1], e.g. Homebrew's alias). */
export function isLegacyProgram(invokedAs: string | undefined): boolean {
  const base = (invokedAs ?? "").replace(/^.*[\\/]/, "").toLowerCase()
  return LEGACY_EXTENSIONS.some((extension) => base === `${LEGACY}${extension}`)
}

const ORDER: readonly LegacyUse["kind"][] = ["program", "variable", "config-file", "project-file"]

function described(use: LegacyUse): string {
  switch (use.kind) {
    case "program":
      return `the command ${LEGACY} (now ${CLI_NAME})`
    case "variable":
      return use.ignored
        ? `${use.name} (ignored, since ${ENV_PREFIX} variables are set; now ${use.replacement})`
        : `${use.name} (now ${use.replacement})`
    case "config-file":
      return `${use.path} (now ${use.replacement}, which the next config edit writes)`
    case "project-file":
      return use.shadowedBy === undefined
        ? `${use.path} (now ${use.replacement})`
        : `${use.path} (ignored next to ${use.shadowedBy})`
  }
}

/** The one warning of a run that uses operate's names; undefined when it uses none. */
export function legacyWarning(uses: readonly LegacyUse[]): string | undefined {
  const ordered = ORDER.flatMap((kind) => uses.filter((use) => use.kind === kind))
  const parts = [...new Set(ordered.map(described))]
  if (parts.length === 0) return undefined
  return `Warning: ${LEGACY} is now ${CLI_NAME}, and its old names stop working in ${LEGACY_REMOVAL}: ${parts.join("; ")}. See ${LEGACY_DOCS}`
}
