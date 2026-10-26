/**
 * Resolves the effective configuration. Precedence per value: flag > environment > profile > default.
 * Pure: the config file content and the environment are passed in. The validators are shared with
 * the config file parser and the `pulse-cli config` edit functions.
 */

import type { PulseCliError } from "../errors.js"
import { compact } from "../util.js"
import { configError } from "./config-error.js"
import { redactUrl } from "./redact.js"
import { resolveHeaders } from "./headers.js"
import { type Env, nonEmpty, pick } from "./pick.js"
import { originOf } from "./login-key.js"
import { authorizationConflict, resolveAuth } from "./resolve-auth.js"
import {
  type ConfigFlags,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_FLAVOR,
  DEFAULT_URL,
  ENV,
  type LoadedConfig,
  OUTPUT_FORMATS,
  type OutputFormat,
  FLAVORS,
  type Flavor,
  type Profile,
  type ProjectSource,
  type ResolvedConfig,
  type SelectedProfile,
  type Source,
} from "./types.js"

/** Largest delay a Node.js timer supports (2^31 - 1 ms, about 24.8 days). */
export const MAX_TIMEOUT_MS = 2_147_483_647

const TRUE_VALUES: readonly string[] = ["1", "true", "yes", "on"]
const FALSE_VALUES: readonly string[] = ["0", "false", "no", "off"]

/** Where the name of the selected profile came from. */
export type ProfileOrigin = "flag" | "env" | "default"

/** Why the selected profile was chosen; a default names the file whose defaultProfile it is. */
function originNote(origin: ProfileOrigin, file: LoadedConfig | undefined): string {
  if (origin === "flag") return ""
  if (origin === "env") return `It is selected by ${ENV.profile}. `
  const project = file?.project
  return project?.defaultProfile === true
    ? `It is the defaultProfile of the project file ${project.source.path}; choose another one with \`pulse-cli config use <profile> --project\`. `
    : "It is the defaultProfile of the config file; choose another one with `pulse-cli config use <profile>`. "
}

/** Error for a profile name that is not in the config file, with the known profiles as hint. */
export function missingProfileError(
  name: string,
  file: LoadedConfig | undefined,
  origin: ProfileOrigin = "flag",
): PulseCliError {
  const known = Object.keys(file?.profiles ?? {})
  const listed = known.length > 0 ? `Known profiles: ${known.join(", ")}. ` : ""
  return configError(
    `Profile "${name}" does not exist`,
    `${originNote(origin, file)}${listed}Create it with \`pulse-cli config set ${name} --url <url>\`.`,
  )
}

/** The profile stored under `name`; inherited object properties never count as profiles. */
export function findProfile(file: LoadedConfig | undefined, name: string): Profile | undefined {
  return file !== undefined && Object.hasOwn(file.profiles, name) ? file.profiles[name] : undefined
}

function profileName(
  flags: ConfigFlags,
  env: Env,
  file: LoadedConfig | undefined,
): { name: string; origin: ProfileOrigin } | undefined {
  const flag = nonEmpty(flags.profile)
  if (flag !== undefined) return { name: flag, origin: "flag" }
  const fromEnv = nonEmpty(env[ENV.profile])
  if (fromEnv !== undefined) return { name: fromEnv, origin: "env" }
  const fallback = nonEmpty(file?.defaultProfile)
  return fallback === undefined ? undefined : { name: fallback, origin: "default" }
}

/** The project file a profile of the loaded configuration comes from, if any. */
function projectOf(file: LoadedConfig | undefined, name: string): ProjectSource | undefined {
  return file?.project?.profiles.includes(name) === true ? file.project.source : undefined
}

/**
 * The selected profile, where it comes from and, when it comes from there, the
 * project file.
 */
export function selectProfile(
  flags: ConfigFlags,
  env: Env,
  file: LoadedConfig | undefined,
): SelectedProfile {
  const selected = profileName(flags, env, file)
  if (selected === undefined) return {}
  const profile = findProfile(file, selected.name)
  if (file === undefined || profile === undefined) {
    throw missingProfileError(selected.name, file, selected.origin)
  }
  const project = projectOf(file, selected.name)
  const origin = originOf(file, selected.name)
  const configFile = project === undefined ? file.configFile : undefined
  return { name: selected.name, profile, ...compact({ project, origin, configFile }) }
}

function parseUrl(url: string): URL {
  try {
    return new URL(url)
  } catch {
    throw configError(`Invalid engine URL "${redactUrl(url)}"`, `Example: ${DEFAULT_URL}`)
  }
}

/** Checks the REST API root URL and removes surrounding blanks and trailing slashes. */
export function validateUrl(url: string, label = "Engine URL", example = DEFAULT_URL): string {
  const trimmed = url.trim()
  const parsed = parseUrl(trimmed)
  // checked first, because the other messages repeat the URL and must never show credentials
  if (parsed.username !== "" || parsed.password !== "") {
    throw configError(
      `${label} must not contain credentials`,
      "Remove the user info from the URL and use Basic auth: --auth basic --auth-user <name> with the password from --auth-password-stdin or PULSE_CLI_PASSWORD.",
    )
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw configError(
      `${label} must start with http:// or https://, got "${redactUrl(trimmed)}"`,
      `Example: ${example}`,
    )
  }
  if (/[?#]/.test(trimmed)) {
    throw configError(
      `${label} must not contain a query string or fragment, got "${redactUrl(trimmed)}"`,
      `Pass credentials as a header (-H, ${ENV.headers}) instead. Example URL: ${example}`,
    )
  }
  return trimmed.replace(/\/+$/, "")
}

export function validateCockpitUrl(url: string): string {
  return validateUrl(url, "Cockpit URL", "http://localhost:8080/operaton/app/cockpit/default")
}

/** True for a usable engine name: not blank, not "." or ".." (they would leave /engine/{name}). */
export function isEngineName(value: unknown): boolean {
  if (typeof value !== "string") return false
  const trimmed = value.trim()
  return trimmed !== "" && trimmed !== "." && trimmed !== ".."
}

/** Checks a process engine name and trims it. */
export function validateEngine(engine: string): string {
  const trimmed = engine.trim()
  if (trimmed === "") {
    throw configError(
      "Engine name must not be empty",
      "Remove it with `pulse-cli config unset <profile> engine` to use the default engine.",
    )
  }
  if (!isEngineName(trimmed)) {
    throw configError(
      `Invalid process engine name "${trimmed}"`,
      "Use the name of a process engine as listed by `pulse-cli ping`, e.g. default; omit it for the default engine.",
    )
  }
  return trimmed
}

export function isFlavor(value: unknown): value is Flavor {
  return FLAVORS.some((flavor) => flavor === value)
}

export function validateFlavor(flavor: string): Flavor {
  const trimmed = flavor.trim()
  if (!isFlavor(trimmed)) {
    throw configError(`Unknown flavor "${trimmed}"`, `Use one of: ${FLAVORS.join(", ")}`)
  }
  return trimmed
}

/** The flavor of flag, environment or profile with its source; `camunda7` by default. */
export function resolveFlavor(
  flags: ConfigFlags,
  env: Env,
  profile: Profile | undefined,
): { readonly value: Flavor; readonly source: Source } {
  const flavor = pick(nonEmpty(flags.flavor), nonEmpty(env[ENV.flavor]), profile?.flavor)
  return {
    value: validateFlavor(flavor.value ?? DEFAULT_FLAVOR),
    source: flavor.source,
  }
}

export function validateOutput(output: string): OutputFormat {
  const format = OUTPUT_FORMATS.find((candidate) => candidate === output)
  if (format === undefined) {
    throw configError(
      `Unknown output format "${output}"`,
      `Use one of: ${OUTPUT_FORMATS.join(", ")}`,
    )
  }
  return format
}

/** True for a timeout a Node.js timer can handle: a whole number of ms in 1..MAX_TIMEOUT_MS. */
export function isTimeout(value: unknown): value is number {
  return (
    typeof value === "number" && Number.isInteger(value) && value > 0 && value <= MAX_TIMEOUT_MS
  )
}

export function parseTimeout(value: string | number): number {
  const timeout = typeof value === "string" && /^\s*\d+\s*$/.test(value) ? Number(value) : value
  if (!isTimeout(timeout)) {
    throw configError(
      `Timeout must be a positive number of milliseconds, got "${value}"`,
      `Use a whole number between 1 and ${MAX_TIMEOUT_MS}, e.g. 60000 for one minute.`,
    )
  }
  return timeout
}

/** Parses PULSE_CLI_READ_ONLY. Blank means unset; unknown values fail instead of silently disabling. */
export function parseReadOnly(value: string | undefined): boolean | undefined {
  const normalized = nonEmpty(value)?.toLowerCase()
  if (normalized === undefined) return undefined
  if (TRUE_VALUES.includes(normalized)) return true
  if (FALSE_VALUES.includes(normalized)) return false
  throw configError(
    `Invalid ${ENV.readOnly} value "${normalized}"`,
    `Use one of: ${[...TRUE_VALUES, ...FALSE_VALUES].join(", ")}.`,
  )
}

function pickAll(flags: ConfigFlags, env: Env, profile: Profile | undefined) {
  return {
    url: pick(nonEmpty(flags.url), nonEmpty(env[ENV.url]), profile?.url),
    engine: pick(nonEmpty(flags.engine), nonEmpty(env[ENV.engine]), profile?.engine),
    output: pick(nonEmpty(flags.output), nonEmpty(env[ENV.output]), profile?.output),
    timeout: pick<string | number>(flags.timeout, nonEmpty(env[ENV.timeout]), profile?.timeout),
    readOnly: pick(flags.readOnly, parseReadOnly(env[ENV.readOnly]), profile?.readOnly),
    headers: resolveHeaders(flags, env, profile),
  }
}

/** How the configuration is used: `authCommand` for `pulse-cli auth login|status|logout`. */
export interface ResolveOptions {
  readonly authCommand?: boolean
}

export function resolveConfig(
  flags: ConfigFlags,
  env: Env,
  file: LoadedConfig | undefined,
  options: ResolveOptions = {},
): ResolvedConfig {
  const selected = selectProfile(flags, env, file)
  const { url, engine, output, timeout, readOnly, headers } = pickAll(flags, env, selected.profile)
  const flavor = resolveFlavor(flags, env, selected.profile)
  const cockpitUrl = selected.profile?.cockpitUrl
  const values = {
    ...compact({
      profile: selected.name,
      cockpitUrl: cockpitUrl === undefined ? undefined : validateCockpitUrl(cockpitUrl),
      engine: engine.value === undefined ? undefined : validateEngine(engine.value),
      output: output.value === undefined ? undefined : validateOutput(output.value),
    }),
    url: validateUrl(url.value ?? DEFAULT_URL),
    flavor: flavor.value,
    timeoutMs: timeout.value === undefined ? DEFAULT_TIMEOUT_MS : parseTimeout(timeout.value),
    headers: headers.value,
    readOnly: readOnly.value ?? false,
  }
  const auth = resolveAuth(flags, env, selected, options.authCommand)
  const conflict = authorizationConflict(
    auth.auth,
    headers.authorization,
    selected.name,
    options.authCommand,
  )
  if (conflict !== undefined) throw conflict
  return {
    ...values,
    auth: auth.auth,
    ...compact({ unusedToken: auth.unusedToken, project: selected.project }),
    sources: {
      url: url.source,
      engine: engine.source,
      flavor: flavor.source,
      auth: auth.source,
      output: output.source,
      timeout: timeout.source,
      headers: headers.source,
      readOnly: readOnly.source,
    },
  }
}
