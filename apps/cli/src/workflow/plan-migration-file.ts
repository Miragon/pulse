/**
 * Where `pulse plan-migration` writes its plan file: the checks before the first request and again
 * right before the write (no symbolic link, which a cloned repository could plant, also none for
 * the folders of the default path; no directory or other entry; a folder that exists), and the
 * write, which replaces a regular file. Over the injected file system; pure otherwise.
 */

import { MigrationPlanFiles } from "@miragon/pulse-migration-plan"
import { usageError } from "../errors.js"
import type { FileSystem } from "../runtime.js"

const MOVE_HINT = "Move it out of the way, or name another path with --plan-file."

/** The folder part of `path`; undefined for a name in the working directory. */
function folderOf(path: string): string | undefined {
  const end = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"))
  if (end < 0) return undefined
  return end === 0 ? path.slice(0, 1) : path.slice(0, end)
}

/** The entries the write could be redirected through: the file, and the default path's folders. */
function entriesOf(path: string, isDefault: boolean): string[] {
  return isDefault ? [".pulse", MigrationPlanFiles.FOLDER, path] : [path]
}

async function refuseLinks(fs: FileSystem, path: string, isDefault: boolean): Promise<void> {
  const entries = entriesOf(path, isDefault)
  const linked = await Promise.all(entries.map((entry) => fs.linked(entry)))
  const link = entries.find((_, index) => linked[index] === true)
  if (link !== undefined) {
    throw usageError(`${link} is a symbolic link; pulse writes no plan file through one`, MOVE_HINT)
  }
}

/** Refuses a target the plan cannot be written to before any engine request. */
export async function checkPlanTarget(
  fs: FileSystem,
  path: string,
  isDefault: boolean,
): Promise<void> {
  await refuseLinks(fs, path, isDefault)
  const kind = await fs.kind(path)
  if (kind === "directory") throw usageError(`${path} is a directory`, MOVE_HINT)
  if (kind === "other") throw usageError(`${path} is not a regular file`, MOVE_HINT)
  const folder = isDefault ? undefined : folderOf(path)
  if (folder !== undefined && (await fs.kind(folder)) !== "directory") {
    throw usageError(
      `The folder ${folder} of --plan-file does not exist`,
      "Create it first, or name a path in a folder that exists.",
    )
  }
}

async function attempt(path: string, write: () => Promise<void>): Promise<void> {
  try {
    await write()
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw usageError(
      `Cannot write ${path}: ${reason}`,
      "Check --plan-file and the folder's permissions.",
    )
  }
}

/** Writes the plan file (the default path's folders first); true when it replaced a file. */
export async function writePlanFile(
  fs: FileSystem,
  path: string,
  text: string,
  isDefault: boolean,
): Promise<boolean> {
  const replaced = (await fs.kind(path)) === "file"
  if (isDefault) await attempt(path, () => fs.mkdir(MigrationPlanFiles.FOLDER))
  await refuseLinks(fs, path, isDefault)
  await attempt(path, () => fs.writeFile(path, text))
  return replaced
}
