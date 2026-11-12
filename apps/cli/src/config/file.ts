/**
 * Location, reading and persistence of the config file. Its profiles are read by
 * @miragon/pulse-profile (profile-file.ts): a secret itself or the variable that holds it may
 * stand in it (the file is the user's own, written with mode 0600).
 */

import { dirname, posix, win32 } from "node:path"
import { PulseCliError } from "../errors.js"
import type { FileSystem } from "../runtime.js"
import { isRecord } from "../util.js"
import { configError } from "./config-error.js"
import { readProfileFile, refusalOf } from "./profile-file.js"
import { invalidFileError } from "./profile-problems.js"
import { type ConfigFile, ENV } from "./types.js"

type Env = Readonly<Record<string, string | undefined>>

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

/**
 * The config file's profiles from its text. Only text that gives no profiles fails the file
 * (CONFIG); a profile the format refuses fails when a command uses it.
 */
export function parseConfigFile(text: string, path: string): ConfigFile {
  const read = readProfileFile(text, "env-or-literal")
  if ("problem" in read) throw invalidFileError(false, path, read.problem)
  return read.file
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
        `Create it with \`pulse config set <profile> --url <url> --config ${path}\`, or fix the path of --config or ${ENV.config}.`,
      )
    }
    data = await fs.readFile(path)
  } catch (error) {
    throw error instanceof PulseCliError ? error : ioError("read", path, error)
  }
  return parseConfigFile(new TextDecoder().decode(data), path)
}

/**
 * The text of a config file: its $schema, default profile and profiles, then the root keys the
 * format does not know as the file held them, indented, with a final newline. What the CLI found
 * (refused profiles, notes) is never written.
 */
export function serializeConfigFile(config: ConfigFile): string {
  const { $schema, defaultProfile, profiles, unknown } = config
  const file = {
    ...($schema === undefined ? {} : { $schema }),
    ...(defaultProfile === undefined ? {} : { defaultProfile }),
    profiles,
    ...unknown,
  }
  return `${JSON.stringify(file, null, 2)}\n`
}

/**
 * The file an edit wrote, as the next command reads it: what `pulse config` shows after an edit,
 * a profile it leaves refused included. A project file is read under its own policy (`none`).
 */
export function writtenFile(config: ConfigFile, project: boolean): ConfigFile {
  const read = readProfileFile(serializeConfigFile(config), project ? "none" : "env-or-literal")
  return "file" in read ? read.file : config
}

/** A name or a key twice: JSON keeps only the last one, so the parsed file has lost the others. */
const TWICE: ReadonlySet<string> = new Set(["duplicate-key", "duplicate-name"])

/**
 * A profile that the file `before` refuses for a name or a key twice and that writing `after` (as
 * `writtenFile` reads it back) would settle without a word, keeping only the last value: an edit
 * must not write that. A profile the edit deletes settles nothing, nor does a twice that survives
 * the write (a header name in two spellings).
 */
export function settledTwice(before: ConfigFile | undefined, after: ConfigFile) {
  for (const [name, problems] of Object.entries(before?.refused ?? {})) {
    if (!Object.hasOwn(after.profiles, name)) continue
    const kept = refusalOf(after, name) ?? []
    const lost = problems.find(
      ({ code, key }) =>
        TWICE.has(code) && !kept.some((problem) => problem.code === code && problem.key === key),
    )
    if (lost !== undefined) return { name, problem: lost }
  }
  return undefined
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
