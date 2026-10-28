/**
 * The project config file: `.pulse-cli.json`, looked up from the working directory
 * upwards, so a repository can ship its profiles. The lookup stops at the repository root (a
 * directory with `.git`), before the home directory and at the file system root; the nearest file
 * wins. Its profiles are merged with those of the user's config file: the user's profile wins on a
 * name clash (a developer overrides one locally), the project's defaultProfile wins (in the
 * repository its default applies) as long as it names a profile of the project file. A project
 * file is shared and names no credentials, neither secrets nor the variables that hold them: they
 * come from the environment (PULSE_CLI_TOKEN, PULSE_CLI_TOKEN_COMMAND, PULSE_CLI_PASSWORD) or the
 * user's own config file. So a cloned repository can neither run code through pulse-cli nor send a
 * variable of its choice to the URL it names.
 */

import type { FileSystem } from "../runtime.js"
import { compact, isRecord, isSecretHeader } from "../util.js"
import { configError } from "./config-error.js"
import { type Location, parseConfigFile, pathModule } from "./file.js"
import {
  type ConfigFile,
  ENV,
  type LoadedConfig,
  type Profile,
  type ProfileAuth,
  type ProjectSource,
} from "./types.js"

export const PROJECT_FILE = ".pulse-cli.json"

/** The project file of a working directory: the nearest one, or where a new one goes. */
export interface ProjectFile {
  readonly path: string
  readonly exists: boolean
}

/** A directory as it is compared with the home directory: no trailing separators, on win32 no case. */
function comparable(path: string, platform: string): string {
  const trimmed = path.replace(/[\\/]+$/, "")
  return platform === "win32" ? trimmed.toLowerCase() : trimmed
}

/** The project file of one directory (PROJECT_FILE). */
async function projectFileIn(
  fs: FileSystem,
  directory: string,
  path: ReturnType<typeof pathModule>,
): Promise<ProjectFile | undefined> {
  const current = path.join(directory, PROJECT_FILE)
  return (await fs.kind(current)) !== "missing" ? { path: current, exists: true } : undefined
}

/**
 * The project file for the working directory `cwd`: the nearest existing `.pulse-cli.json` from `cwd` up to the repository root, else where
 * `config set --project` creates one (the repository root, else `cwd`). Undefined in the home
 * directory itself: it is nobody's project.
 */
export async function findProjectFile(
  fs: FileSystem,
  cwd: string,
  location: Location,
): Promise<ProjectFile | undefined> {
  const path = pathModule(location.platform)
  const home = comparable(location.homedir, location.platform)
  let directory = cwd
  for (;;) {
    if (comparable(directory, location.platform) === home) {
      return directory === cwd ? undefined : { path: path.join(cwd, PROJECT_FILE), exists: false }
    }
    const found = await projectFileIn(fs, directory, path)
    if (found !== undefined) return found
    if ((await fs.kind(path.join(directory, ".git"))) !== "missing") {
      return { path: path.join(directory, PROJECT_FILE), exists: false }
    }
    const parent = path.dirname(directory)
    if (parent === directory) return { path: path.join(cwd, PROJECT_FILE), exists: false }
    directory = parent
  }
}

/** The credential keys of a profile's auth object, and where the credential comes from instead. */
const CREDENTIALS: Readonly<Partial<Record<keyof ProfileAuth, string>>> = {
  password: ENV.password,
  passwordEnv: ENV.password,
  token: `${ENV.token} or ${ENV.tokenCommand}`,
  tokenEnv: `${ENV.token} or ${ENV.tokenCommand}`,
}

function secretProblem(name: string, profile: Profile): string | undefined {
  const key = Object.keys(CREDENTIALS).find(
    (candidate) => profile.auth?.[candidate as keyof ProfileAuth] !== undefined,
  )
  if (key !== undefined) {
    return `profile "${name}" sets auth.${key}; a project file is shared and names no credentials, so it comes from ${CREDENTIALS[key as keyof ProfileAuth] ?? ""} or a profile "${name}" of your own config file`
  }
  const header = Object.keys(profile.headers ?? {}).find(isSecretHeader)
  return header === undefined
    ? undefined
    : `profile "${name}" stores the secret header ${header}; a project file is shared, so secret headers go into ${ENV.headers} or a profile of your own config file`
}

/**
 * Why a project file must not store `file`: a password or token, or the variable
 * that holds one, or a secret header. Undefined when it holds none.
 */
export function projectSecretProblem(file: ConfigFile): string | undefined {
  for (const [name, profile] of Object.entries(file.profiles)) {
    const problem = secretProblem(name, profile)
    if (problem !== undefined) return problem
  }
  return undefined
}

/** A defaultProfile that names no profile of the file itself. */
function defaultProblem(file: ConfigFile): string | undefined {
  const name = given(file.defaultProfile)
  return name === undefined || Object.hasOwn(file.profiles, name)
    ? undefined
    : `defaultProfile "${name}" is not one of its profiles; a project file chooses only among its own profiles`
}

const CREDENTIAL_HINT = `Credentials come from the environment (${ENV.token}, ${ENV.tokenCommand}, ${ENV.password}) or from a profile of the same name in your own config file. Remove it from the project file, e.g. with \`pulse-cli config unset <profile> auth --project\` (\`headers\` for a secret header), and a committed secret from the history of your repository, too.`

const DEFAULT_HINT =
  "Make one of its profiles the default with `pulse-cli config use <profile> --project`, or remove defaultProfile from the file."

/**
 * Why `file` is no valid project file, and how to fix it: a credential (projectSecretProblem) or a
 * defaultProfile that is not one of its profiles. Undefined when it is valid.
 */
export function projectProblem(
  file: ConfigFile,
): { readonly problem: string; readonly hint: string } | undefined {
  const secret = projectSecretProblem(file)
  if (secret !== undefined) return { problem: secret, hint: CREDENTIAL_HINT }
  const foreign = defaultProblem(file)
  return foreign === undefined ? undefined : { problem: foreign, hint: DEFAULT_HINT }
}

/**
 * Parses a project file and refuses credentials in it (the value is never quoted) and a
 * defaultProfile it does not define (CONFIG).
 */
export function parseProjectFile(text: string, path: string): ConfigFile {
  const file = parseConfigFile(text, path)
  const invalid = projectProblem(file)
  if (invalid !== undefined) {
    throw configError(`Invalid project file ${path}: ${invalid.problem}`, invalid.hint)
  }
  return file
}

/** `EACCES`, `EISDIR`, ... of a file system error, else its message. */
function reasonOf(error: unknown): string {
  const code = isRecord(error) ? error.code : undefined
  if (typeof code === "string") return code
  return error instanceof Error ? error.message : String(error)
}

/** Reads and checks an existing project file. */
export async function readProjectFile(fs: FileSystem, path: string): Promise<ConfigFile> {
  let content: Uint8Array
  try {
    content = await fs.readFile(path)
  } catch (error) {
    throw configError(
      `Cannot read project file ${path} (${reasonOf(error)})`,
      "Check the file and its permissions; pulse-cli looks up .pulse-cli.json from the working directory up to the repository root.",
    )
  }
  return parseProjectFile(new TextDecoder().decode(content), path)
}

function given(name: string | undefined): string | undefined {
  return name === undefined || name.trim() === "" ? undefined : name.trim()
}

/**
 * The configuration a command sees: the user's config file with the profiles of the project file
 * merged in. A profile of the user's file replaces the project's profile of the same name as a
 * whole. The project's defaultProfile wins over the user's, but only for a profile that comes from
 * the project file: a repository never makes a profile of the user's (e.g. "prod") the default.
 */
export function mergeProject(
  user: LoadedConfig | undefined,
  project: { readonly source: ProjectSource; readonly file: ConfigFile } | undefined,
): LoadedConfig | undefined {
  if (project === undefined) return user
  const own = user?.profiles ?? {}
  const profiles = Object.keys(project.file.profiles).filter((name) => !Object.hasOwn(own, name))
  const named = given(project.file.defaultProfile)
  const projectDefault = named !== undefined && profiles.includes(named) ? named : undefined
  const defaultProfile = projectDefault ?? user?.defaultProfile
  return {
    ...compact({ defaultProfile }),
    profiles: { ...project.file.profiles, ...own },
    project: { source: project.source, profiles, defaultProfile: projectDefault !== undefined },
  }
}
