import {
  chmod,
  mkdir,
  mkdtemp,
  realpath,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { PulseCliError } from "../errors.js"
import { createNodeRuntime } from "./node-runtime.js"

const original = Object.getOwnPropertyDescriptor(process.stdin, "isTTY")

afterEach(() => {
  if (original === undefined) Reflect.deleteProperty(process.stdin, "isTTY")
  else Object.defineProperty(process.stdin, "isTTY", original)
})

describe("createNodeRuntime().readStdin", () => {
  it("refuses to wait for a terminal with a one-line message and hint for both stdin uses", async () => {
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true })
    const error: unknown = await createNodeRuntime()
      .readStdin()
      .then(
        () => undefined,
        (reason: unknown) => reason,
      )
    expect(error).toBeInstanceOf(PulseCliError)
    const { code, message, details } = error as PulseCliError
    expect(code).toBe("USAGE")
    expect(message).toBe("stdin is a terminal; pipe the input into the command")
    expect(details.hint).toBe(
      `Examples: echo '{}' | pulse-cli ... --body - (or --body @file.json); printf '%s\\n' "$PASSWORD" | pulse-cli ... --auth-password-stdin (a token: --auth-token-stdin).`,
    )
    // rendered errors are single lines; a template literal "\n" would break the printf example
    expect(details.hint).not.toMatch(/[\r\n]/)
  })
})

describe.skipIf(process.platform === "win32")(
  "createNodeRuntime().fs.writeFile with a mode",
  () => {
    let dir = ""
    const fs = createNodeRuntime().fs
    const modeOf = async (path: string) => (await stat(path)).mode & 0o777

    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), "pulse-cli-fs-"))
    })

    afterEach(async () => {
      await chmod(dir, 0o700)
      await rm(dir, { recursive: true, force: true })
    })

    it("replaces an existing file readable by others with a private one, leaving no temporary file", async () => {
      const path = join(dir, "config.json")
      await writeFile(path, "old", { mode: 0o644 })
      await chmod(path, 0o644)
      await fs.writeFile(path, "secret", { mode: 0o600 })
      expect(await readFile(path, "utf8")).toBe("secret")
      expect(await modeOf(path)).toBe(0o600)
      expect(await readdir(dir)).toEqual(["config.json"])
    })

    it("creates a new file with the mode", async () => {
      const path = join(dir, "new.json")
      await fs.writeFile(path, "secret", { mode: 0o600 })
      expect(await modeOf(path)).toBe(0o600)
    })

    it("keeps a symlinked config file linked and writes its target", async () => {
      const target = join(dir, "dotfiles.json")
      const link = join(dir, "config.json")
      await writeFile(target, "old", { mode: 0o644 })
      await symlink(target, link)
      await fs.writeFile(link, "secret", { mode: 0o600 })
      expect((await stat(link)).isFile()).toBe(true)
      expect(await readFile(target, "utf8")).toBe("secret")
      expect(await modeOf(target)).toBe(0o600)
      expect((await readdir(dir)).sort()).toEqual(["config.json", "dotfiles.json"])
    })

    it("removes the temporary file when the rename fails", async () => {
      const path = join(dir, "config.json")
      await mkdir(path)
      await expect(fs.writeFile(path, "secret", { mode: 0o600 })).rejects.toThrow()
      expect(await readdir(dir)).toEqual(["config.json"])
    })

    it.skipIf(process.getuid?.() === 0)(
      "writes in place, private first, in a directory it may not create files in",
      async () => {
        const path = join(dir, "config.json")
        await writeFile(path, "old", { mode: 0o644 })
        await chmod(path, 0o644)
        await chmod(dir, 0o500)
        await fs.writeFile(path, "secret", { mode: 0o600 })
        expect(await readFile(path, "utf8")).toBe("secret")
        expect(await modeOf(path)).toBe(0o600)
        await expect(fs.writeFile(join(dir, "other.json"), "x", { mode: 0o600 })).rejects.toThrow()
      },
    )

    it("writes files without a mode in place", async () => {
      const path = join(dir, "out.bin")
      await fs.writeFile(path, Uint8Array.of(1, 2))
      expect([...(await readFile(path))]).toEqual([1, 2])
    })
  },
)

describe.skipIf(process.platform === "win32")("createNodeRuntime().fs", () => {
  let dir = ""
  const runtime = createNodeRuntime()

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "pulse-cli-fs-"))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it("removes files, telling whether there was one, and creates directories with a mode", async () => {
    const file = join(dir, "x.json")
    await writeFile(file, "{}")
    await expect(runtime.fs.remove(file)).resolves.toBe(true)
    await expect(runtime.fs.remove(file)).resolves.toBe(false)
    const tokens = join(dir, "pulse-cli", "tokens")
    await runtime.fs.mkdir(tokens, { mode: 0o700 })
    expect((await stat(tokens)).mode & 0o777).toBe(0o700)
    await runtime.fs.mkdir(tokens, { mode: 0o755 })
    expect((await stat(tokens)).mode & 0o777).toBe(0o700)
  })
})

describe.skipIf(process.platform === "win32")("createNodeRuntime().fs.readdir and kind", () => {
  let dir = ""
  const fs = createNodeRuntime().fs

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "pulse-cli-scan-"))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it("reports files, directories, links to files and links to directories", async () => {
    await writeFile(join(dir, "a.bpmn"), "<x/>")
    await mkdir(join(dir, "sub"))
    await symlink(join(dir, "a.bpmn"), join(dir, "link.bpmn"))
    await symlink(join(dir, "sub"), join(dir, "linked-dir"))
    const entries = (await fs.readdir(dir)).toSorted((left, right) =>
      left.name.localeCompare(right.name),
    )
    expect(entries).toEqual([
      { name: "a.bpmn", kind: "file" },
      { name: "link.bpmn", kind: "file" },
      { name: "linked-dir", kind: "other" },
      { name: "sub", kind: "directory" },
    ])
    expect(await fs.kind(join(dir, "a.bpmn"))).toBe("file")
    expect(await fs.kind(join(dir, "sub"))).toBe("directory")
    expect(await fs.kind(join(dir, "linked-dir"))).toBe("directory")
    expect(await fs.kind(join(dir, "missing"))).toBe("missing")
    expect(await fs.kind(join(dir, "a.bpmn", "below"))).toBe("missing")
  })
})

describe("createNodeRuntime().sleep", () => {
  it("waits at least the given time", async () => {
    const runtime = createNodeRuntime()
    const started = runtime.now()
    await runtime.sleep(20)
    expect(runtime.now() - started).toBeGreaterThanOrEqual(15)
  })
})

describe("createNodeRuntime().runCommand", () => {
  const runtime = createNodeRuntime()
  const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes)

  it("runs a command line in the shell and captures stdout, stderr and the exit code", async () => {
    const result = await runtime.runCommand('echo "tok-$(echo abc)"; echo oops >&2; exit 3', {
      timeoutMs: 10_000,
    })
    expect(result.exitCode).toBe(3)
    expect(result.timedOut).toBe(false)
    expect(text(result.stdout)).toBe("tok-abc\n")
    expect(text(result.stderr)).toBe("oops\n")
  })

  it("runs in the working directory with stdin closed", async () => {
    const result = await runtime.runCommand("pwd; cat; echo done", { timeoutMs: 10_000 })
    expect(result.exitCode).toBe(0)
    const [cwd, done] = text(result.stdout).trim().split("\n")
    expect(await realpath(cwd ?? "")).toBe(await realpath(process.cwd()))
    expect(done).toBe("done")
  })

  it("adds the given variables to the environment it inherits", async () => {
    const result = await runtime.runCommand('echo "$PULSE_CLI_TOKEN_URL|$PATH"', {
      timeoutMs: 10_000,
      env: { PULSE_CLI_TOKEN_URL: "https://engine.example/engine-rest" },
    })
    expect(text(result.stdout)).toBe(
      `https://engine.example/engine-rest|${process.env.PATH ?? ""}\n`,
    )
  })

  it("stops a command that runs too long", async () => {
    const started = Date.now()
    const result = await runtime.runCommand("echo started; sleep 5", { timeoutMs: 200 })
    expect(result.timedOut).toBe(true)
    expect(result.exitCode).toBeNull()
    expect(Date.now() - started).toBeLessThan(4_000)
  })

  it("keeps at most 1 MiB of output", async () => {
    const result = await runtime.runCommand("head -c 1100000 /dev/zero", { timeoutMs: 10_000 })
    expect(result.exitCode).toBe(0)
    expect(result.stdout.length).toBe(1_048_576)
  })
})
