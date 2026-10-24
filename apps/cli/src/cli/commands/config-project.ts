/**
 * The project file part of `operate config` (design §22): the file an edit writes (the user's
 * config file, or with `--project` the project file `.operate.json`), and the checks and notices
 * of edits next to a project file.
 */

import { configError } from '../../config/config-error.js';
import { readConfigFile, writeConfigFile } from '../../config/file.js';
import {
  findProjectFile,
  PROJECT_FILE,
  projectProblem,
  readProjectFile,
} from '../../config/project.js';
import { findProfile } from '../../config/resolve.js';
import { type ConfigFile, ENV } from '../../config/types.js';
import { usageError } from '../../errors.js';
import type { Runtime } from '../../runtime.js';
import { configPath, isExplicit, projectFileOf } from '../config-files.js';

export const PROJECT_OPTION = [
  '--project',
  `Write the project file (${PROJECT_FILE} of the repository, shared with the team) instead of your config file`,
] as const;

/** The file an edit writes, and the project file of the working directory for notices. */
export interface EditTarget {
  readonly path: string;
  readonly project: boolean;
  /** The user's file was named by `--config` or OPERATE_CONFIG. */
  readonly explicit?: boolean;
  /** The project file in effect, read best effort, when the edit writes the user's file. */
  readonly other?: { readonly path: string; readonly file: ConfigFile };
}

function noProjectDirectory(runtime: Runtime) {
  return configError(
    `No project directory: ${runtime.cwd} is your home directory`,
    `operate looks up ${PROJECT_FILE} from the working directory up to the repository root; run the command inside the repository (\`config set --project\` creates the file at its root).`,
  );
}

/** The project file in effect, read best effort (an invalid one is reported by other commands). */
async function projectInEffect(runtime: Runtime, flag: string | undefined) {
  try {
    const found = await projectFileOf(runtime, flag);
    if (found?.exists !== true) return undefined;
    return { path: found.path, file: await readProjectFile(runtime.fs, found.path) };
  } catch {
    return undefined;
  }
}

/** The file of an edit: the project file with `--project`, else the user's config file. */
export async function editTarget(
  runtime: Runtime,
  flags: { readonly config?: string | undefined; readonly project?: boolean | undefined },
): Promise<EditTarget> {
  if (flags.project !== true) {
    const other = await projectInEffect(runtime, flags.config);
    const path = configPath(runtime, flags.config);
    const explicit = isExplicit(runtime, flags.config);
    return other === undefined
      ? { path, project: false, explicit }
      : { path, project: false, explicit, other };
  }
  if (flags.config !== undefined) {
    throw usageError(
      '--project and --config exclude each other',
      `--project writes the project file (${PROJECT_FILE}); --config names your own config file.`,
    );
  }
  const found = await findProjectFile(runtime.fs, runtime.cwd, runtime);
  if (found === undefined) throw noProjectDirectory(runtime);
  return { path: found.path, project: true };
}

/**
 * The current content of the target. A project file is read without its checks, so that an edit
 * can remove what they refuse (`config unset <profile> tokenEnv --project`); writeTarget checks.
 */
export function readTarget(runtime: Runtime, target: EditTarget): Promise<ConfigFile | undefined> {
  return readConfigFile(runtime.fs, target.path);
}

/**
 * Writes the edited file. A project file must stay free of credentials and choose its default
 * among its own profiles (CONFIG, nothing written), and is readable by others (0644, it is
 * shared).
 */
export async function writeTarget(
  runtime: Runtime,
  target: EditTarget,
  file: ConfigFile,
): Promise<void> {
  if (!target.project) {
    await writeConfigFile(runtime.fs, target.path, file);
    return;
  }
  const invalid = projectProblem(file);
  if (invalid !== undefined) {
    throw configError(
      `The project file ${target.path} cannot be written: ${invalid.problem}`,
      invalid.hint,
    );
  }
  await writeConfigFile(runtime.fs, target.path, file, 0o644);
}

/**
 * `config unset|use|delete` of a profile that only the project file has, without `--project`:
 * CONFIG, pointing to `--project` (the user's file does not have it).
 */
export function checkUserProfile(target: EditTarget, file: ConfigFile | undefined, name: string) {
  const other = target.other;
  if (target.project || other === undefined || findProfile(file, name) !== undefined) return;
  if (findProfile(other.file, name) === undefined) return;
  throw configError(
    `Profile "${name}" is a profile of the project file ${other.path}, not of your config file`,
    `Add --project to change the project file; \`operate config set ${name} <options>\` without it creates a profile of your own that overrides the project's.`,
  );
}

type Other = NonNullable<EditTarget['other']>;

/** The user's file got a profile that the project file has, too: it now overrides it. */
function overrideNotice(other: Other, name: string, before?: ConfigFile, after?: ConfigFile) {
  const added = findProfile(before, name) === undefined && findProfile(after, name) !== undefined;
  if (!added || findProfile(other.file, name) === undefined) return undefined;
  return `Notice: profile "${name}" of your config file now overrides the profile of the same name in the project file ${other.path} as a whole: none of the project's settings of "${name}" apply. Add --project to change the project's profile instead.`;
}

/** The user's file got another default, but the project file's default wins in the repository. */
function defaultNotice(other: Other, before: ConfigFile | undefined, after: ConfigFile) {
  const projectDefault = other.file.defaultProfile?.trim() ?? '';
  if (after.defaultProfile === before?.defaultProfile || projectDefault === '') return undefined;
  // a profile of the user's file of the same name takes the project's default away
  if (findProfile(after, projectDefault) !== undefined) return undefined;
  return `Notice: in this repository the defaultProfile of the project file ${other.path} ("${projectDefault}") wins; use --profile, ${ENV.profile} or \`operate config use <profile> --project\`.`;
}

/** Notices after an edit of the user's file next to a project file. */
export function overrideNotices(
  target: EditTarget,
  name: string,
  before: ConfigFile | undefined,
  after: ConfigFile,
): string[] {
  const other = target.other;
  if (target.project || other === undefined) return [];
  return [overrideNotice(other, name, before, after), defaultNotice(other, before, after)].filter(
    (notice) => notice !== undefined,
  );
}
