/**
 * The project config file: `.pulse.json`, looked up from the working directory
 * upwards, so a repository can ship its profiles. The lookup stops at the repository root (a
 * directory with `.git`), before the home directory and at the file system root; the nearest file
 * wins. Its profiles are merged with those of the user's config file: the user's profile wins on a
 * name clash (a developer overrides one locally), the project's default wins (in the repository
 * its default applies) as long as it is a profile of the project file: its defaultProfile, else
 * its only profile. A project file is shared and is read under the credential policy `none` of
 * @miragon/pulse-profile: a profile that names a credential, a secret or the variable that holds
 * one, or a secret header is refused, so no resolver ever reads a variable the repository chose.
 * Credentials come from the environment (PULSE_CLI_TOKEN, PULSE_CLI_TOKEN_COMMAND,
 * PULSE_CLI_PASSWORD, PULSE_CLI_OAUTH_CLIENT_SECRET) or the user's own config file. So a cloned
 * repository can neither run code through pulse nor send a variable of its choice to the URL it
 * names. Its profiles share OAuth logins only among the profiles of its repository
 * (`projectOrigin`). A directory on the way that holds the file only under its former name
 * (FORMER_PROJECT_FILE) fails the lookup with a hint to rename it, so a command never runs with the
 * user's own default where the repository meant its profiles.
 */

import { describeProblem, type Problem, PROFILE_NAME } from "@miragon/pulse-profile"
import type { FileSystem } from "../runtime.js"
import { compact, isRecord } from "../util.js"
import { configError } from "./config-error.js"
import { type Location, pathModule, serializeConfigFile } from "./file.js"
import { readProfileFile } from "./profile-file.js"
import { invalidFileError, problemHint } from "./profile-problems.js"
import { type ConfigFile, ENV, type LoadedConfig, type ProjectSource } from "./types.js"

export const PROJECT_FILE = ".pulse.json"

/** The project file's name up to 0.27, read no more: named only to fail with a hint to rename it. */
const FORMER_PROJECT_FILE = ".pulse-cli.json"

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

/**
 * A directory holds the project file only under its former name: CONFIG, rename it, or name your
 * own config file, which skips the lookup (where the file cannot be renamed).
 */
function formerNameError(former: string, current: string) {
  return configError(
    `The project file ${former} has its former name; pulse reads ${PROJECT_FILE} only`,
    `Rename it to ${current}; its content stays as it is. To skip the project file, name your config file with --config or ${ENV.config}.`,
  )
}

/**
 * The project file of one directory (PROJECT_FILE); the directory fails with formerNameError when
 * it holds the file only under its former name (FORMER_PROJECT_FILE).
 */
async function projectFileIn(
  fs: FileSystem,
  directory: string,
  path: ReturnType<typeof pathModule>,
): Promise<ProjectFile | undefined> {
  const current = path.join(directory, PROJECT_FILE)
  if ((await fs.kind(current)) !== "missing") return { path: current, exists: true }
  const former = path.join(directory, FORMER_PROJECT_FILE)
  if ((await fs.kind(former)) !== "missing") throw formerNameError(former, current)
  return undefined
}

/**
 * The project file for the working directory `cwd`: the nearest existing `.pulse.json` from `cwd` up to the repository root, else where
 * `config set --project` creates one (the repository root, else `cwd`). Undefined in the home
 * directory itself: it is nobody's project. Fails (CONFIG) at the first directory on the way that
 * holds the file only under its former name.
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

/** The text of a file, or undefined when it cannot be read. */
async function textOf(fs: FileSystem, path: string): Promise<string | undefined> {
  try {
    return new TextDecoder().decode(await fs.readFile(path))
  } catch {
    return undefined
  }
}

/**
 * The git directory shared by the worktree whose `.git` file is `dotGit`: the `gitdir:` it names
 * must be `<git directory>/worktrees/<name>` and link back to `dotGit` with its own `gitdir` file,
 * as `git worktree add` writes them. A `.git` file that only claims a repository (copied, or
 * pointing elsewhere) does not count, nor does a submodule (`<git directory>/modules/<name>`).
 */
async function worktreeRepository(fs: FileSystem, dotGit: string, location: Location) {
  const path = pathModule(location.platform)
  const named = /^gitdir: (.+)$/m.exec((await textOf(fs, dotGit)) ?? "")?.[1]?.trim()
  if (named === undefined) return undefined
  const gitDir = path.resolve(path.dirname(dotGit), named)
  const worktrees = path.dirname(gitDir)
  if (comparable(path.basename(worktrees), location.platform) !== "worktrees") return undefined
  const back = (await textOf(fs, path.join(gitDir, "gitdir")))?.trim()
  if (back === undefined || back === "") return undefined
  const linked = comparable(path.resolve(gitDir, back), location.platform)
  return linked === comparable(dotGit, location.platform) ? path.dirname(worktrees) : undefined
}

/**
 * True when a `.git` found in `directory` may name a repository: the current user owns it (like
 * git's safe.directory check: another user's `/tmp/.git` makes nobody's project a repository) and
 * it is not in a file system root. Windows has no owners to compare (`ownedByUser` is absent):
 * there only `C:\\.git` and the like are refused.
 */
async function trusted(fs: FileSystem, directory: string, dotGit: string, location: Location) {
  if (pathModule(location.platform).dirname(directory) === directory) return false
  return fs.ownedByUser === undefined || fs.ownedByUser(dotGit)
}

/**
 * The git directory of the repository that `directory` belongs to: the first `.git` from there up
 * to the repository root (before the home directory and the file system root), the directory
 * itself or, for a worktree, the git directory it links back to; none for a `.git` that is not
 * `trusted`. Paths are compared as given, symbolic links are not followed: a link never makes two
 * repositories one.
 */
async function repositoryOf(fs: FileSystem, directory: string, location: Location) {
  const path = pathModule(location.platform)
  const home = comparable(location.homedir, location.platform)
  for (let current = directory; comparable(current, location.platform) !== home;) {
    const dotGit = path.join(current, ".git")
    const kind = await fs.kind(dotGit)
    if (kind !== "missing") {
      if (!(await trusted(fs, current, dotGit, location))) return undefined
      if (kind === "directory") return dotGit
      return kind === "file" ? worktreeRepository(fs, dotGit, location) : undefined
    }
    const parent = path.dirname(current)
    if (parent === current) return undefined
    current = parent
  }
  return undefined
}

/**
 * Where the profiles of the project file `projectPath` come from (`LoginKey.origin`):
 * its repository (`repository:<git directory>`), so that all worktrees of a repository
 * share their logins, else the project file itself (`project:<path>`).
 */
export async function projectOrigin(
  fs: FileSystem,
  projectPath: string,
  location: Location,
): Promise<string> {
  const path = pathModule(location.platform)
  const repository = await repositoryOf(fs, path.dirname(projectPath), location)
  return repository === undefined
    ? `project:${comparable(path.resolve(projectPath), location.platform)}`
    : `repository:${comparable(path.resolve(repository), location.platform)}`
}

/**
 * Parses a project file under the credential policy `none`: only text that gives no profiles
 * fails it (CONFIG); a profile that names a credential is refused when a command uses it.
 */
export function parseProjectFile(text: string, path: string): ConfigFile {
  const read = readProfileFile(text, "none")
  if ("problem" in read) throw invalidFileError(true, path, read.problem)
  return read.file
}

/** The problems a project file must never be written with: a credential, a secret header. */
const UNWRITABLE: ReadonlySet<string> = new Set(["credential-in-shared-file", "secret-header"])

function credentialOf(file: ConfigFile) {
  for (const [name, problems] of Object.entries(file.refused ?? {})) {
    const problem = problems.find(({ code }) => UNWRITABLE.has(code))
    if (problem !== undefined) return { name, problem }
  }
  return undefined
}

/**
 * Why the CLI must not write `file` as the project file at `path`, or undefined: a profile names
 * a credential or a secret header, or the defaultProfile is none of its profiles. Nothing a
 * repository shares ever gets a credential from `pulse config`.
 */
export function projectWriteError(file: ConfigFile, path: string) {
  const read = readProfileFile(serializeConfigFile(file), "none")
  const checked = "file" in read ? read.file : file
  const credential = credentialOf(checked)
  const cannot = `The project file ${path} cannot be written`
  if (credential !== undefined) {
    const { name, problem } = credential
    const shown = PROFILE_NAME.test(name) ? `profile "${name}"` : "a profile"
    return configError(
      `${cannot}: in ${shown}, ${describeProblem(problem)}`,
      problemHint(name, problem, true),
    )
  }
  const note = checked.notes?.find(({ key }) => key === "defaultProfile")
  return note === undefined
    ? undefined
    : configError(
        `${cannot}: ${describeProblem(note)}`,
        "Make one of its profiles the default with `pulse config use <profile> --project`, or remove defaultProfile from the file.",
      )
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
      "Check the file and its permissions; pulse looks up .pulse.json from the working directory up to the repository root.",
    )
  }
  return parseProjectFile(new TextDecoder().decode(content), path)
}

function given(name: string | undefined): string | undefined {
  return name === undefined || name.trim() === "" ? undefined : name.trim()
}

/** The note a file holds on its defaultProfile (one that is no string), if any. */
function defaultNote(file: ConfigFile): Problem | undefined {
  return file.notes?.find(({ key }) => key === "defaultProfile")
}

const INVALID_DEFAULT: Problem = { code: "invalid-name", key: "defaultProfile" }

/**
 * The user's config file as a command sees it on its own: its defaultProfile as it stands, and
 * why it gives no default when it is no string or no valid name (a valid name of no profile fails
 * as "does not exist", naming it, when a command needs it).
 */
export function userDefault(user: ConfigFile): Pick<LoadedConfig, "defaultProblem"> {
  const named = given(user.defaultProfile)
  if (named !== undefined)
    return PROFILE_NAME.test(named) ? {} : { defaultProblem: { problem: INVALID_DEFAULT } }
  const note = defaultNote(user)
  return note === undefined ? {} : { defaultProblem: { problem: note } }
}

/** The only profile of a file whose name is no valid name (it is not shown). */
const INVALID_ONLY: Problem = { code: "invalid-name" }

/**
 * The default the project file gives: its defaultProfile when that names one of its profiles,
 * else, without a defaultProfile, its only profile, a refused one too; a defaultProfile that names
 * none of its profiles (or is no valid name, or no string) or an only profile without a valid
 * name gives no default at all (`problem`), never the user's. Neither (no profile, or several and
 * no defaultProfile): the project gives no default, and the user's applies.
 */
function projectDefault(file: ConfigFile): { name?: string; problem?: Problem } {
  const named = given(file.defaultProfile)
  if (named !== undefined) {
    if (!PROFILE_NAME.test(named)) return { problem: INVALID_DEFAULT }
    return Object.hasOwn(file.profiles, named)
      ? { name: named }
      : { problem: { code: "default-not-found", key: "defaultProfile" } }
  }
  const note = defaultNote(file)
  if (note !== undefined) return { problem: note }
  const [only, ...more] = Object.keys(file.profiles)
  if (only === undefined || more.length > 0) return {}
  return PROFILE_NAME.test(only) ? { name: only } : { problem: INVALID_ONLY }
}

/** A project file and where it is, as a command merges it. */
interface Project {
  readonly source: ProjectSource
  readonly file: ConfigFile
}

type Defaults = Pick<LoadedConfig, "defaultProfile" | "defaultProblem">

/**
 * The default of the merged configuration: the project's when it is one of `fromProject` (the
 * project's profiles the user does not override), none with the project's problem, else the
 * user's. `chosen` is the project's default as `projectDefault` gives it.
 */
function mergedDefault(
  user: LoadedConfig | undefined,
  project: Project,
  fromProject: readonly string[],
): { readonly defaults: Defaults; readonly fromProject: boolean } {
  const chosen = projectDefault(project.file)
  if (chosen.problem !== undefined) {
    const defaultProblem = { problem: chosen.problem, project: project.source.path }
    return { defaults: { defaultProblem }, fromProject: false }
  }
  const name = chosen.name
  if (name !== undefined && fromProject.includes(name)) {
    return { defaults: { defaultProfile: name }, fromProject: true }
  }
  const own = compact({
    defaultProfile: user?.defaultProfile,
    defaultProblem: user?.defaultProblem,
  })
  return { defaults: own, fromProject: false }
}

/** The refused profiles of both files: the user's, and the project's the user does not override. */
function mergedRefused(user: LoadedConfig | undefined, project: Project, own: readonly string[]) {
  const fromProject = Object.entries(project.file.refused ?? {}).filter(
    ([key]) => !own.includes(key),
  )
  const refused = { ...Object.fromEntries(fromProject), ...user?.refused }
  return Object.keys(refused).length === 0 ? {} : { refused }
}

/**
 * The configuration a command sees: the user's config file with the profiles of the project file
 * merged in. A profile of the user's file replaces the project's profile of the same name as a
 * whole, problems included. The project's default (projectDefault) wins over the user's, but
 * only for a profile that comes from the project file: a repository never makes a profile of the
 * user's (e.g. "prod") the default, and a defaultProfile of the project that names none of its
 * profiles leaves no default instead of falling back to the user's.
 */
export function mergeProject(
  user: LoadedConfig | undefined,
  project: Project | undefined,
): LoadedConfig | undefined {
  if (project === undefined) return user
  const own = user?.profiles ?? {}
  const overridden = Object.keys(own)
  const profiles = Object.keys(project.file.profiles).filter((name) => !overridden.includes(name))
  const merged = mergedDefault(user, project, profiles)
  return {
    ...compact({ origin: user?.origin, notes: user?.notes }),
    ...merged.defaults,
    profiles: { ...project.file.profiles, ...own },
    ...mergedRefused(user, project, overridden),
    project: {
      source: project.source,
      profiles,
      defaultProfile: merged.fromProject,
      ...compact({ notes: project.file.notes }),
    },
  }
}
