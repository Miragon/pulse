/**
 * The Runtime on Node.js: process streams (a closed pipe such as `| head` ends output quietly),
 * stdin, the file system, fetch, the environment and working directory, timers, for OAuth random
 * bytes, the loopback server, the browser and the lock file, and the shell for token commands.
 */

import { randomBytes } from "node:crypto"
import type { Dirent } from "node:fs"
import {
  chmod,
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises"
import { homedir } from "node:os"
import { basename, dirname, join } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { usageError } from "../errors.js"
import type { DirectoryEntry, FileSystem, OutputStream, PathKind, Runtime } from "../runtime.js"
import { openBrowser } from "./browser.js"
import { runCommand } from "./command.js"
import { withLock } from "./lock.js"
import { listenLoopback } from "./loopback.js"

/** Largest request of `crypto.getRandomValues`. */
const RANDOM_CHUNK = 65_536

function errorCode(error: unknown): unknown {
  return typeof error === "object" && error !== null && "code" in error ? error.code : undefined
}

/** The parts of a process stream used here; `isTTY` is undefined (not false) for pipes and files. */
interface ProcessStream {
  readonly isTTY?: boolean
  readonly columns?: number
  write(chunk: string | Uint8Array): unknown
  on(event: "error", listener: (error: Error) => void): unknown
}

/**
 * Wraps a process stream. EPIPE (the reader went away) stops further output instead of crashing
 * with an unhandled 'error' event and a stack trace; other stream errors are rethrown.
 */
function outputStream(stream: ProcessStream): OutputStream {
  let closed = false
  stream.on("error", (error) => {
    if (errorCode(error) !== "EPIPE") throw error
    closed = true
  })
  const isTTY = stream.isTTY === true
  return {
    write(chunk) {
      if (!closed) stream.write(chunk)
    },
    isTTY,
    // pseudo terminals of `script` or `docker exec -t` report 0 columns: unknown width
    ...(isTTY && stream.columns !== undefined && stream.columns > 0
      ? { columns: stream.columns }
      : {}),
  }
}

/** Reads stdin completely; refuses to wait for a terminal (operate never prompts). */
async function readStdin(stdin: NodeJS.ReadStream = process.stdin): Promise<Uint8Array> {
  if (stdin.isTTY) {
    throw usageError(
      "stdin is a terminal; pipe the input into the command",
      `Examples: echo '{}' | operate ... --body - (or --body @file.json); printf '%s\\n' "$PASSWORD" | operate ... --auth-password-stdin (a token: --auth-token-stdin).`,
    )
  }
  const chunks: Buffer[] = []
  for await (const chunk of stdin) chunks.push(Buffer.from(chunk as Uint8Array))
  return new Uint8Array(Buffer.concat(chunks))
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    const code = errorCode(error)
    if (code === "ENOENT" || code === "ENOTDIR") return false
    throw error
  }
}

/** The file `path` names, symlinks resolved (a linked config file stays linked); else `path`. */
async function linkTarget(path: string): Promise<string> {
  try {
    return await realpath(path)
  } catch (error) {
    if (errorCode(error) === "ENOENT") return path
    throw error
  }
}

/**
 * In place, for a directory the user may not create files in: an existing file gets `mode` before
 * the first byte (and a chmod that fails, on a file of another user, writes nothing).
 */
async function writeInPlace(path: string, data: string | Uint8Array, mode: number) {
  if (await exists(path)) await chmod(path, mode)
  await writeFile(path, data, { mode })
}

/**
 * Writes a private file (the config file may hold credentials) atomically: a new file next to the
 * target, created exclusively with `mode`, then renamed over it. The content is never readable
 * under the old mode of an existing file (writeFile applies `mode` only to new files), and a
 * crash leaves the old or the new file, never half of one.
 */
async function writePrivateFile(path: string, data: string | Uint8Array, mode: number) {
  const target = await linkTarget(path)
  const temporary = join(
    dirname(target),
    `.${basename(target)}.${randomBytes(6).toString("hex")}.tmp`,
  )
  try {
    await writeFile(temporary, data, { mode, flag: "wx" })
  } catch (error) {
    const code = errorCode(error)
    if (code !== "EACCES" && code !== "EPERM") throw error
    await writeInPlace(target, data, mode)
    return
  }
  try {
    // the umask may have cleared bits of `mode`
    await chmod(temporary, mode)
    await rename(temporary, target)
  } catch (error) {
    await rm(temporary, { force: true })
    throw error
  }
}

/** Removes a file; false when it did not exist. */
async function remove(path: string): Promise<boolean> {
  try {
    await rm(path)
    return true
  } catch (error) {
    if (errorCode(error) === "ENOENT") return false
    throw error
  }
}

/** What a path names, symlinks followed; a missing path (or a file in the way) is `missing`. */
async function pathKind(path: string): Promise<PathKind> {
  try {
    const info = await stat(path)
    if (info.isFile()) return "file"
    return info.isDirectory() ? "directory" : "other"
  } catch (error) {
    const code = errorCode(error)
    if (code === "ENOENT" || code === "ENOTDIR") return "missing"
    throw error
  }
}

/** A directory entry; a link to a file counts as a file, a link to a directory is not followed. */
async function entryKind(directory: string, entry: Dirent): Promise<DirectoryEntry["kind"]> {
  if (entry.isDirectory()) return "directory"
  if (entry.isFile()) return "file"
  if (!entry.isSymbolicLink()) return "other"
  return (await pathKind(join(directory, entry.name))) === "file" ? "file" : "other"
}

async function directoryEntries(path: string): Promise<DirectoryEntry[]> {
  const entries = await readdir(path, { withFileTypes: true })
  return Promise.all(
    entries.map(async (entry) => ({ name: entry.name, kind: await entryKind(path, entry) })),
  )
}

/** Whether the current user owns the entry itself (lstat); false when it is missing. */
async function ownedByUser(path: string, uid: number): Promise<boolean> {
  try {
    return (await lstat(path)).uid === uid
  } catch {
    return false
  }
}

/** The owner check where the platform has user ids (not on Windows). */
function ownership(): Pick<FileSystem, "ownedByUser"> {
  const uid = process.getuid?.()
  return uid === undefined ? {} : { ownedByUser: (path) => ownedByUser(path, uid) }
}

const nodeFileSystem: FileSystem = {
  readFile: async (path) => new Uint8Array(await readFile(path)),
  async writeFile(path, data, options) {
    const mode = options?.mode
    await (mode === undefined ? writeFile(path, data) : writePrivateFile(path, data, mode))
  },
  async mkdir(path, options) {
    await mkdir(path, {
      recursive: true,
      ...(options?.mode === undefined ? {} : { mode: options.mode }),
    })
  },
  exists,
  remove,
  readdir: directoryEntries,
  kind: pathKind,
  ...ownership(),
}

/** Cryptographically strong random bytes from WebCrypto, in chunks it accepts. */
function strongRandomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length)
  for (let offset = 0; offset < length; offset += RANDOM_CHUNK) {
    crypto.getRandomValues(bytes.subarray(offset, Math.min(length, offset + RANDOM_CHUNK)))
  }
  return bytes
}

/** Resolves after `ms` without keeping the process alive. */
function deadline(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms).unref())
}

export function createNodeRuntime(): Runtime {
  return {
    env: process.env,
    cwd: process.cwd(),
    stdout: outputStream(process.stdout),
    stderr: outputStream(process.stderr),
    readStdin: () => readStdin(),
    fetch: globalThis.fetch,
    fs: nodeFileSystem,
    homedir: homedir(),
    platform: process.platform,
    now: () => Date.now(),
    randomBytes: strongRandomBytes,
    listenLoopback,
    openBrowser: (url) => openBrowser(url, process.env, process.platform),
    withLock,
    deadline,
    sleep: (ms) => delay(ms),
    runCommand,
  }
}
