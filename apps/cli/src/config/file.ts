/** Location, parsing, validation and persistence of the config file. */

import { dirname, posix, win32 } from "node:path"
import { OperateError } from "../errors.js"
import type { FileSystem } from "../runtime.js"
import { isRecord } from "../util.js"
import { jsonErrorPosition } from "./json-position.js"
import { profileAuthProblem } from "./auth.js"
import { PROFILE_NAME } from "./syntax.js"
import { configError } from "./config-error.js"
import { isHeaderName, isHeaderValue } from "./headers.js"
import { MAX_TIMEOUT_MS, isEngineName, isFlavor, isTimeout } from "./resolve.js"
import {
  type ConfigFile,
  ENV,
  OUTPUT_FORMATS,
  FLAVORS,
  PROFILE_KEYS,
  type Profile,
  type ProfileKey,
} from "./types.js"

type Env = Readonly<Record<string, string | undefined>>

const ROOT_KEYS: readonly string[] = ["$schema", "defaultProfile", "profiles"]

function given(value: string | undefined): string | undefined {
  return value === undefined || value.trim() === "" ? undefined : value
}

/** An environment directory is only used when it is an absolute path (XDG Base Directory spec). */
function absoluteDir(value: string | undefined, path: typeof posix): string | undefined {
  return value !== undefined && path.isAbsolute(value) ? value : undefined
}

/** The config file named by `--config` or PULSE_CLI_CONFIG, if any (else the default location). */
export function explicitConfigPath(env: Env, flag?: string): string | undefined {
  return given(flag) ?? given(env[ENV.config])
}

export interface Location {
  readonly homedir: string
  readonly platform: string
}

/** The path functions of the platform (win32 or posix). */
export function pathModule(platform: string): typeof posix {
  return platform === "win32" ? win32 : posix
}

/** The directory of the user's config file and tokens under the platform's config home. */
const CONFIG_DIRECTORY = "pulse-cli"

/** The config directory of the platform (never derived from `--config` / PULSE_CLI_CONFIG). */
function configDirectory(env: Env, location: Location): string {
  if (location.platform === "win32") {
    const appData =
      absoluteDir(env.APPDATA, win32) ?? win32.join(location.homedir, "AppData", "Roaming")
    return win32.join(appData, CONFIG_DIRECTORY)
  }
  const configHome =
    absoluteDir(env.XDG_CONFIG_HOME, posix) ?? posix.join(location.homedir, ".config")
  return posix.join(configHome, CONFIG_DIRECTORY)
}

/**
 * Config file location: `--config` > PULSE_CLI_CONFIG > $XDG_CONFIG_HOME/pulse-cli/config.json >
 * ~/.config/pulse-cli/config.json; on Windows %APPDATA%\pulse-cli\config.json.
 */
export function configFilePath(env: Env, location: Location, explicit?: string): string {
  const chosen = explicitConfigPath(env, explicit)
  if (chosen !== undefined) return chosen
  return pathModule(location.platform).join(configDirectory(env, location), "config.json")
}

/**
 * The OAuth token cache directory: $XDG_CONFIG_HOME/pulse-cli/tokens >
 * ~/.config/pulse-cli/tokens; on Windows %APPDATA%\pulse-cli\tokens. Never next to a config file
 * named by `--config` or PULSE_CLI_CONFIG: a project-local (possibly committed) config file must not
 * get token files beside it.
 */
export function tokenDirectory(env: Env, location: Location): string {
  return pathModule(location.platform).join(configDirectory(env, location), "tokens")
}

/** A file of the token directory (win32 or posix join). */
export function tokenPath(directory: string, fileName: string, platform: string): string {
  return pathModule(platform).join(directory, fileName)
}

function fail(path: string, problem: string): never {
  throw configError(
    `Invalid config file ${path}: ${problem}`,
    "Fix the file or recreate it with `pulse-cli config set`.",
  )
}

function checkKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  where: string,
  path: string,
): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key))
  if (unknown.length > 0) {
    fail(path, `unknown key(s) ${unknown.join(", ")} in ${where} (allowed: ${allowed.join(", ")})`)
  }
}

function isNonEmptyString(value: unknown): boolean {
  return typeof value === "string" && value.trim() !== ""
}

function isHeaderMap(value: unknown): boolean {
  return (
    isRecord(value) &&
    Object.entries(value).every(
      ([name, entry]) => isHeaderName(name) && typeof entry === "string" && isHeaderValue(entry),
    )
  )
}

type Check = readonly [check: (value: unknown) => boolean, expected: string]

/** Checks of the plain profile values; the auth object has its own (`profileAuthProblem`). */
const PROFILE_CHECKS: Readonly<Record<Exclude<ProfileKey, "auth">, Check>> = {
  url: [isNonEmptyString, "a URL such as http://localhost:8080/engine-rest"],
  cockpitUrl: [
    isNonEmptyString,
    "a URL such as http://localhost:8080/operaton/app/cockpit/default/",
  ],
  engine: [isEngineName, 'a process engine name, not "." or ".."'],
  flavor: [isFlavor, `one of ${FLAVORS.join(", ")}`],
  output: [
    (value) => OUTPUT_FORMATS.some((format) => format === value),
    OUTPUT_FORMATS.join(" or "),
  ],
  timeout: [isTimeout, `a whole number of milliseconds between 1 and ${MAX_TIMEOUT_MS}`],
  headers: [
    isHeaderMap,
    "an object mapping header names (not Connection, Content-Length, Expect, Keep-Alive, Transfer-Encoding or Upgrade) to ISO-8859-1 (Latin-1) string values without control characters",
  ],
  readOnly: [(value) => typeof value === "boolean", "true or false"],
}

function valueProblem(name: string, key: ProfileKey, value: unknown): string | undefined {
  if (key === "auth") return profileAuthProblem(name, value)
  const [check, expected] = PROFILE_CHECKS[key]
  return check(value) ? undefined : `profile "${name}" has an invalid ${key} (expected ${expected})`
}

/** A profile name as JSON (control characters escaped: the file may come from anywhere). */
function quoted(name: string): string {
  return JSON.stringify(name)
}

const NAME_RULE =
  'use letters, digits, ".", "_" and "-", starting with a letter or digit; rename it in the file'

function validateProfile(name: string, value: unknown, path: string): Profile {
  if (!PROFILE_NAME.test(name)) fail(path, `invalid profile name ${quoted(name)} (${NAME_RULE})`)
  if (!isRecord(value)) fail(path, `profile "${name}" must be an object`)
  checkKeys(value, PROFILE_KEYS, `profile "${name}"`, path)
  for (const key of PROFILE_KEYS) {
    const problem = Object.hasOwn(value, key) ? valueProblem(name, key, value[key]) : undefined
    if (problem !== undefined) fail(path, problem)
  }
  return value
}

/**
 * "not valid JSON (line 3, column 14)". Never the parser message: V8 quotes the text around the
 * error, which may be a stored credential.
 */
function syntaxProblem(text: string): string {
  const position = jsonErrorPosition(text)
  return position === undefined
    ? "not valid JSON"
    : `not valid JSON (line ${position.line}, column ${position.column})`
}

/** defaultProfile: a string; blank means none, anything else must be a valid profile name. */
function checkDefaultProfile(value: unknown, path: string): asserts value is string | undefined {
  if (value === undefined) return
  if (typeof value !== "string") fail(path, "defaultProfile must be a string")
  const name = value.trim()
  if (name !== "" && !PROFILE_NAME.test(name)) {
    fail(path, `invalid defaultProfile ${quoted(name)} (${NAME_RULE})`)
  }
}

export function parseConfigFile(text: string, path: string): ConfigFile {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    fail(path, syntaxProblem(text))
  }
  if (!isRecord(parsed)) fail(path, "expected a JSON object")
  checkKeys(parsed, ROOT_KEYS, "the root object", path)
  const { defaultProfile, profiles = {} } = parsed
  checkDefaultProfile(defaultProfile, path)
  if (!isRecord(profiles)) fail(path, "profiles must be an object")
  return {
    ...(defaultProfile === undefined ? {} : { defaultProfile }),
    profiles: Object.fromEntries(
      Object.entries(profiles).map(([name, profile]) => [
        name,
        validateProfile(name, profile, path),
      ]),
    ),
  }
}

/** `EACCES`, `EISDIR`, ... of a file system error, else its message. */
function reasonOf(error: unknown): string {
  const code = isRecord(error) ? error.code : undefined
  if (typeof code === "string") return code
  return error instanceof Error ? error.message : String(error)
}

function ioError(action: "read" | "write", path: string, error: unknown) {
  return configError(
    `Cannot ${action} config file ${path} (${reasonOf(error)})`,
    `Check the path and its permissions, or choose another file with --config or ${ENV.config}.`,
  )
}

/**
 * Reads and validates the config file. A missing file means "no profiles", unless `required` (the
 * user named the file with --config or PULSE_CLI_CONFIG: a typo must not silently drop the
 * profile, its headers and its read-only guard).
 */
export async function readConfigFile(
  fs: FileSystem,
  path: string,
  required = false,
): Promise<ConfigFile | undefined> {
  let data: Uint8Array
  try {
    if (!(await fs.exists(path))) {
      if (!required) return undefined
      throw configError(
        `Config file ${path} does not exist`,
        `Create it with \`pulse-cli config set <profile> --url <url> --config ${path}\`, or fix the path of --config or ${ENV.config}.`,
      )
    }
    data = await fs.readFile(path)
  } catch (error) {
    throw error instanceof OperateError ? error : ioError("read", path, error)
  }
  return parseConfigFile(new TextDecoder().decode(data), path)
}

/** The text of a config file: its default profile and profiles, indented, with a final newline. */
function serializeConfigFile(config: ConfigFile): string {
  const { defaultProfile, profiles } = config
  return `${JSON.stringify({ ...(defaultProfile === undefined ? {} : { defaultProfile }), profiles }, null, 2)}\n`
}

/**
 * Writes the file atomically with mode 0600 (it may contain credentials: headers, a Basic auth
 * password); a project file, which holds no secrets and is shared, with 0644.
 */
export async function writeConfigFile(
  fs: FileSystem,
  path: string,
  config: ConfigFile,
  mode = 0o600,
): Promise<void> {
  try {
    await fs.mkdir(dirname(path))
    await fs.writeFile(path, serializeConfigFile(config), { mode })
  } catch (error) {
    throw ioError("write", path, error)
  }
}
