/**
 * The configuration a command reads: the config file named by `--config` or
 * PULSE_CLI_CONFIG alone (it must exist), else the project file (`.pulse-cli.json`, looked up from the
 * working directory up to the repository root) merged with the user's config file. Until
 * LEGACY_REMOVAL the legacy files stand in where the new ones are missing (`legacyFileUses`).
 */

import {
  explicitConfigPath,
  pathModule,
  readConfigFile,
  type UserConfigFile,
  userConfigFile,
} from "../config/file.js"
import type { LegacyUse } from "../config/legacy.js"
import { configOrigin } from "../config/login-key.js"
import {
  findProjectFile,
  mergeProject,
  PROJECT_FILE,
  type ProjectFile,
  projectOrigin,
  readProjectFile,
} from "../config/project.js"
import type { ConfigFile, LoadedConfig, ProjectSource } from "../config/types.js"
import type { Runtime } from "../runtime.js"

/** The user's config file in effect for `--config`, PULSE_CLI_CONFIG or the platform default. */
export function userConfig(runtime: Runtime, flag: string | undefined): Promise<UserConfigFile> {
  return userConfigFile(runtime.fs, runtime.env, runtime, flag)
}

/** True when the config file was named by `--config` or PULSE_CLI_CONFIG: then it must exist. */
export function isExplicit(runtime: Runtime, flag: string | undefined): boolean {
  return explicitConfigPath(runtime.env, flag) !== undefined
}

export interface LoadedFiles {
  /** The user's config file, or the one named by `--config` / PULSE_CLI_CONFIG. */
  readonly path: string
  /** The project file in effect (never next to an explicit config file). */
  readonly project?: ProjectSource
  /** What the command sees: the profiles of both files. */
  readonly config: LoadedConfig | undefined
}

/** The project file of the working directory; none with an explicit config file. */
export async function projectFileOf(
  runtime: Runtime,
  flag: string | undefined,
): Promise<ProjectFile | undefined> {
  if (isExplicit(runtime, flag)) return undefined
  return findProjectFile(runtime.fs, runtime.cwd, runtime)
}

async function projectOf(runtime: Runtime, path: string) {
  const file = await readProjectFile(runtime.fs, path)
  const source: ProjectSource = {
    path,
    directory: pathModule(runtime.platform).dirname(path),
    origin: await projectOrigin(runtime.fs, path, runtime),
  }
  return { source, file }
}

/**
 * The user's config file, or the one named by `--config` / PULSE_CLI_CONFIG (`explicit`), with the
 * origin of its profiles: the canonical path, so a login made while the legacy file is read
 * survives the first edit, which writes the canonical file.
 */
function withOrigin(
  runtime: Runtime,
  user: UserConfigFile,
  file: ConfigFile | undefined,
  explicit: boolean,
): LoadedConfig | undefined {
  if (file === undefined) return undefined
  const origin = configOrigin(user.canonical, runtime.cwd, runtime.platform)
  if (!explicit) return { ...file, origin }
  const configFile = pathModule(runtime.platform).resolve(runtime.cwd, user.path)
  return { ...file, origin, configFile }
}

/** Reads the config file(s) of a command. */
export async function loadConfig(runtime: Runtime, flag: string | undefined): Promise<LoadedFiles> {
  const user = await userConfig(runtime, flag)
  const { path } = user
  const explicit = isExplicit(runtime, flag)
  const config = withOrigin(
    runtime,
    user,
    await readConfigFile(runtime.fs, path, explicit),
    explicit,
  )
  const found = await projectFileOf(runtime, flag)
  if (found?.exists !== true) return { path, config }
  const project = await projectOf(runtime, found.path)
  return { path, project: project.source, config: mergeProject(config, project) }
}

/** The legacy files a run reads, for the one warning; none with an explicit config file. */
export async function legacyFileUses(
  runtime: Runtime,
  flag: string | undefined,
): Promise<readonly LegacyUse[]> {
  if (isExplicit(runtime, flag)) return []
  const user = await userConfig(runtime, flag)
  const project = await findProjectFile(runtime.fs, runtime.cwd, runtime)
  const uses: LegacyUse[] = []
  if (user.legacy) uses.push({ kind: "config-file", path: user.path, replacement: user.canonical })
  if (project?.legacy === true) {
    uses.push({ kind: "project-file", path: project.path, replacement: PROJECT_FILE })
  }
  if (project?.shadowed !== undefined) {
    const shadowedBy = project.path
    uses.push({
      kind: "project-file",
      path: project.shadowed,
      replacement: PROJECT_FILE,
      shadowedBy,
    })
  }
  return uses
}
