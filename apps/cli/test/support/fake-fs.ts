/**
 * The in-memory file system of the fake runtime (fake-runtime.ts): files, directories and other
 * entries, Node.js style errors and the owners of the entries.
 */

import type { DirectoryEntry, FileSystem, PathKind } from "../../src/runtime.js"

export interface StoredFile {
  readonly data: Uint8Array
  readonly mode?: number
}

/** How the file system treats owners and names (the same options of `FakeRuntimeOptions`). */
export interface FsOptions {
  /** Paths another user owns (`ownedByUser` is false for them, and for missing paths). */
  readonly foreign?: readonly string[]
  /** The file system has no owners, like on Windows (`ownedByUser` is absent). */
  readonly noOwners?: boolean
}

const encoder = new TextEncoder()

export function toBytes(data: string | Uint8Array): Uint8Array {
  return typeof data === "string" ? encoder.encode(data) : data
}

/** A Node.js style file system error (`code` is what the CLI looks at). */
function fsError(code: string, path: string): Error {
  return Object.assign(new Error(`${code}: no such file or directory, open '${path}'`), { code })
}

export interface FakeTree {
  readonly files: Map<string, StoredFile>
  readonly dirs: Set<string>
  readonly others: ReadonlySet<string>
  readonly dirModes: Map<string, number | undefined>
}

function withoutSlash(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, "") : path
}

/** `dir/`, or nothing for the current directory. */
function prefixOf(path: string): string {
  const trimmed = withoutSlash(path)
  return trimmed === "." ? "" : `${trimmed}/`
}

function allPaths(tree: FakeTree): string[] {
  return [...tree.files.keys(), ...tree.dirs, ...tree.others]
}

function pathKind(tree: FakeTree, raw: string): PathKind {
  const path = withoutSlash(raw)
  if (tree.others.has(path)) return "other"
  if (tree.files.has(path)) return "file"
  const prefix = prefixOf(path)
  const below = allPaths(tree).some((entry) => entry.startsWith(prefix))
  return tree.dirs.has(path) || below ? "directory" : "missing"
}

function entriesOf(tree: FakeTree, path: string): DirectoryEntry[] {
  const prefix = prefixOf(path)
  const entries = new Map<string, DirectoryEntry>()
  for (const entry of allPaths(tree)) {
    if (!entry.startsWith(prefix) || entry === prefix) continue
    const [name = "", ...rest] = entry.slice(prefix.length).split("/")
    const kind = rest.length > 0 ? "directory" : pathKind(tree, entry)
    entries.set(name, { name, kind: kind === "missing" ? "other" : kind })
  }
  return [...entries.values()]
}

export function fakeFileSystem(tree: FakeTree): FileSystem {
  const { files, dirs, dirModes } = tree
  return {
    readFile(path) {
      const file = files.get(path)
      if (file === undefined) {
        return Promise.reject(dirs.has(path) ? fsError("EISDIR", path) : fsError("ENOENT", path))
      }
      return Promise.resolve(file.data)
    },
    writeFile(path, data, options) {
      if (dirs.has(path)) return Promise.reject(fsError("EISDIR", path))
      const mode = options?.mode ?? files.get(path)?.mode
      files.set(path, mode === undefined ? { data: toBytes(data) } : { data: toBytes(data), mode })
      return Promise.resolve()
    },
    mkdir(path, options) {
      dirs.add(path)
      if (!dirModes.has(path)) dirModes.set(path, options?.mode)
      return Promise.resolve()
    },
    exists: (path) => Promise.resolve(files.has(path) || dirs.has(path)),
    remove: (path) => Promise.resolve(files.delete(path)),
    readdir(path) {
      const kind = pathKind(tree, path)
      if (kind === "directory") return Promise.resolve(entriesOf(tree, path))
      return Promise.reject(fsError(kind === "missing" ? "ENOENT" : "ENOTDIR", path))
    },
    kind: (path) => Promise.resolve(pathKind(tree, path)),
  }
}

/** The owners of the fake file system: none with `noOwners`, else the user's but `foreign`. */
export function withOwners(fs: FileSystem, tree: FakeTree, options: FsOptions): FileSystem {
  if (options.noOwners === true) return fs
  const foreign = new Set<string>(options.foreign ?? [])
  const ownedByUser = (path: string) =>
    Promise.resolve(pathKind(tree, path) !== "missing" && !foreign.has(path))
  return { ...fs, ownedByUser }
}
