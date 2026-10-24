/**
 * The configuration a command reads: the config file named by `--config` or
 * PULSE_CLI_CONFIG alone (it must exist), else the project file (`.pulse-cli.json`, looked up from the
 * working directory up to the repository root) merged with the user's config file.
 */

import { configFilePath, explicitConfigPath, pathModule, readConfigFile } from "../config/file.js"
import { configOrigin } from "../config/login-key.js"
import {
  findProjectFile,
  mergeProject,
  type ProjectFile,
  projectOrigin,
  readProjectFile,
} from "../config/project.js"
import type { ConfigFile, LoadedConfig, ProjectSource } from "../config/types.js"
import type { Runtime } from "../runtime.js"

/** Path of the config file for `--config`, PULSE_CLI_CONFIG or the platform default. */
export function configPath(runtime: Runtime, explicit: string | undefined): string {
  return configFilePath(runtime.env, runtime, explicit)
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
 * origin of its profiles.
 */
function withOrigin(
  runtime: Runtime,
  path: string,
  file: ConfigFile | undefined,
  explicit: boolean,
): LoadedConfig | undefined {
  if (file === undefined) return undefined
  const origin = configOrigin(path, runtime.cwd, runtime.platform)
  if (!explicit) return { ...file, origin }
  return { ...file, origin, configFile: pathModule(runtime.platform).resolve(runtime.cwd, path) }
}

/** Reads the config file(s) of a command. */
export async function loadConfig(runtime: Runtime, flag: string | undefined): Promise<LoadedFiles> {
  const path = configPath(runtime, flag)
  const explicit = isExplicit(runtime, flag)
  const user = withOrigin(runtime, path, await readConfigFile(runtime.fs, path, explicit), explicit)
  const found = await projectFileOf(runtime, flag)
  if (found?.exists !== true) return { path, config: user }
  const project = await projectOf(runtime, found.path)
  return { path, project: project.source, config: mergeProject(user, project) }
}
