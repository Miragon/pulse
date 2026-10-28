/**
 * Everything the CLI needs from the outside world. Production wires Node.js in `src/bin`, tests pass
 * in-memory fakes, so every command can run in-process without touching the real system.
 */

export interface OutputStream {
  write(chunk: string | Uint8Array): void
  readonly isTTY: boolean
  /** Terminal width, if known. */
  readonly columns?: number
}

/** What a path names; symbolic links are resolved, so a link to a directory is `other`. */
export type PathKind = "file" | "directory" | "missing" | "other"

/** One entry of a directory listing. */
export interface DirectoryEntry {
  readonly name: string
  /** `other` for everything that is neither a file nor a directory, also symlinked directories. */
  readonly kind: "file" | "directory" | "other"
}

export interface FileSystem {
  readFile(path: string): Promise<Uint8Array>
  /** With a `mode`, a private file: written atomically, never readable with another mode. */
  writeFile(path: string, data: string | Uint8Array, options?: { mode?: number }): Promise<void>
  /** Creates the directory and its parents; `mode` applies to the directories it creates. */
  mkdir(path: string, options?: { mode?: number }): Promise<void>
  exists(path: string): Promise<boolean>
  /** Removes a file; resolves false when it did not exist. */
  remove(path: string): Promise<boolean>
  /** The entries of a directory, in no particular order. */
  readdir(path: string): Promise<DirectoryEntry[]>
  /** What `path` is; never throws for a missing path. */
  kind(path: string): Promise<PathKind>
}

/** How `runCommand` runs a command line (in the working directory). */
export interface CommandOptions {
  /** The command is killed once it runs longer. */
  readonly timeoutMs: number
  /** Variables added to the environment the command inherits. */
  readonly env?: Readonly<Record<string, string>>
}

/** What a command line did: its exit code and output (both streams cut after 1 MiB). */
export interface CommandResult {
  /** null when a signal ended it, also the kill after the timeout. */
  readonly exitCode: number | null
  /** It ran longer than `timeoutMs` and was killed. */
  readonly timedOut: boolean
  readonly stdout: Uint8Array
  readonly stderr: Uint8Array
}

export interface Runtime {
  readonly env: Readonly<Record<string, string | undefined>>
  /** The current working directory (absolute): project config files are looked up from it. */
  readonly cwd: string
  readonly stdout: OutputStream
  readonly stderr: OutputStream
  readStdin(): Promise<Uint8Array>
  readonly fetch: typeof globalThis.fetch
  readonly fs: FileSystem
  readonly homedir: string
  readonly platform: string
  /** Milliseconds since epoch; injectable for deterministic tests. */
  now(): number
  /**
   * Waits `ms` milliseconds and keeps the process alive meanwhile, like any pending work (the
   * polling of the workflow commands; the fake runtime advances its clock instead).
   */
  sleep(ms: number): Promise<void>
  /**
   * Runs a command line in the shell (`sh -c`, `cmd.exe /d /s /c` on Windows) in the working
   * directory, with stdin closed and stdout and stderr captured; rejects when it cannot be
   * started. Only the bearer token command (PULSE_CLI_TOKEN_COMMAND) runs one.
   */
  runCommand(command: string, options: CommandOptions): Promise<CommandResult>
}
