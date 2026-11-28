/**
 * Where `pulse plan-migration` writes its plan file: the checks before the first request and again
 * right before the write (no symbolic link, which a cloned repository could plant, also none for
 * the folders of the default path; no directory or other entry; a folder that exists; a default
 * file name a file system holds; a regular file there only with --replace, so an edited plan is
 * never lost without a word), and the write, which without --replace creates the file exclusively,
 * so a file that appears after the last check stays as it is. Every file system failure is a usage
 * error naming the plan file. Over the injected file system; pure otherwise.
 */

import { MigrationPlanFiles } from "@miragon/pulse-migration-plan"
import { usageError } from "../errors.js"
import type { FileSystem } from "../runtime.js"
import { isRecord } from "../util.js"

const MOVE_HINT = "Move it out of the way, or name another path with --plan-file."

/**
 * The longest file name, in UTF-8 bytes, most file systems hold (ext4, APFS, Btrfs, XFS; NTFS
 * counts 255 UTF-16 code units, never more than the UTF-8 bytes of the same name).
 */
const MAX_NAME_BYTES = 255

/** The plan file: its path, whether pulse chose it (no --plan-file) and may replace a file there. */
interface PlanTarget {
  readonly path: string
  readonly isDefault: boolean
  /** `--replace`: a regular file at the path is replaced, else the command refuses it. */
  readonly replace: boolean
}

/** The folder part of `path`; undefined for a name in the working directory. */
function folderOf(path: string): string | undefined {
  const end = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"))
  if (end < 0) return undefined
  return end === 0 ? path.slice(0, 1) : path.slice(0, end)
}

/** A failed file system call for the plan file: a usage error naming the file. */
function failure(target: PlanTarget, error: unknown) {
  const reason = error instanceof Error ? error.message : String(error)
  return usageError(
    `Cannot write ${target.path}: ${reason}`,
    target.isDefault
      ? "Check the folder's permissions, or name another path with --plan-file."
      : "Check --plan-file and the folder's permissions.",
  )
}

/** A file system call for the plan file; a failure is a usage error naming the file. */
async function attempt<T>(target: PlanTarget, call: () => Promise<T>): Promise<T> {
  try {
    return await call()
  } catch (error) {
    throw failure(target, error)
  }
}

/** The entries the write could be redirected through: the file, and the default path's folders. */
function entriesOf(target: PlanTarget): string[] {
  return target.isDefault ? [".pulse", MigrationPlanFiles.FOLDER, target.path] : [target.path]
}

async function refuseLinks(fs: FileSystem, target: PlanTarget): Promise<void> {
  const entries = entriesOf(target)
  const linked = await attempt(target, () => Promise.all(entries.map((entry) => fs.linked(entry))))
  const link = entries.find((_, index) => linked[index] === true)
  if (link !== undefined) {
    throw usageError(`${link} is a symbolic link; pulse writes no plan file through one`, MOVE_HINT)
  }
}

/** Refuses a default file name no file system holds: the key is a BPMN id of up to 255 letters. */
function refuseLongName(path: string): void {
  const name = path.slice(path.lastIndexOf("/") + 1)
  const bytes = new TextEncoder().encode(name).length
  if (bytes <= MAX_NAME_BYTES) return
  throw usageError(
    `The default file name ${name} has ${String(bytes)} bytes; file systems hold at most ${String(MAX_NAME_BYTES)}`,
    "Name a shorter path with --plan-file.",
  )
}

/** A regular file is at the path and `--replace` is not given: USAGE, the file stays as it is. */
function refuseExisting(target: PlanTarget, exists: boolean): void {
  if (!exists || target.replace) return
  throw usageError(
    `The plan file ${target.path} exists`,
    "Add --replace to replace it (edits made in the file are lost), or name another path with --plan-file.",
  )
}

/**
 * Refuses a target the plan cannot be written to before any engine request; true when a regular
 * file is there, which only `replace` lets the write replace.
 */
export async function checkPlanTarget(fs: FileSystem, target: PlanTarget): Promise<boolean> {
  const { path, isDefault } = target
  if (isDefault) refuseLongName(path)
  await refuseLinks(fs, target)
  const kind = await attempt(target, () => fs.kind(path))
  if (kind === "directory") throw usageError(`${path} is a directory`, MOVE_HINT)
  if (kind === "other") throw usageError(`${path} is not a regular file`, MOVE_HINT)
  refuseExisting(target, kind === "file")
  const folder = isDefault ? undefined : folderOf(path)
  if (folder !== undefined && (await attempt(target, () => fs.kind(folder))) !== "directory") {
    throw usageError(
      `The folder ${folder} of --plan-file does not exist`,
      "Create it first, or name a path in a folder that exists.",
    )
  }
  return kind === "file"
}

/**
 * The write itself; without `replace` an exclusive one, so that an entry at the path, one that
 * appeared after the last check too, fails it (EEXIST) and is refused like before the requests.
 */
async function writeText(fs: FileSystem, target: PlanTarget, text: string): Promise<void> {
  try {
    await fs.writeFile(target.path, text, target.replace ? undefined : { exclusive: true })
  } catch (error) {
    refuseExisting(target, isRecord(error) && error.code === "EEXIST")
    throw failure(target, error)
  }
}

/**
 * Writes the plan file (the default path's folders first); true when it replaced a file. A file
 * there without `replace` (one that appeared since the check) is refused like before the requests.
 */
export async function writePlanFile(
  fs: FileSystem,
  target: PlanTarget,
  text: string,
): Promise<boolean> {
  const { path, isDefault } = target
  const replaced = (await attempt(target, () => fs.kind(path))) === "file"
  refuseExisting(target, replaced)
  if (isDefault) await attempt(target, () => fs.mkdir(MigrationPlanFiles.FOLDER))
  await refuseLinks(fs, target)
  await writeText(fs, target, text)
  return replaced
}
