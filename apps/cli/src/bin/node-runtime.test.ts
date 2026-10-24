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
  utimes,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { OperateError } from "../errors.js"
import { browserCommand, openBrowser } from "./browser.js"
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
    expect(error).toBeInstanceOf(OperateError)
    const { code, message, details } = error as OperateError
    expect(code).toBe("USAGE")
    expect(message).toBe("stdin is a terminal; pipe the input into the command")
    expect(details.hint).toBe(
      `Examples: echo '{}' | operate ... --body - (or --body @file.json); printf '%s\\n' "$PASSWORD" | operate ... --auth-password-stdin (a token: --auth-token-stdin).`,
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
      dir = await mkdtemp(join(tmpdir(), "operate-fs-"))
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

describe("createNodeRuntime OAuth parts", () => {
  const runtime = createNodeRuntime()

  it("serves the loopback handler on 127.0.0.1 only, with the security headers, until closed", async () => {
    const seen: string[] = []
    const server = await runtime.listenLoopback(0, (request) => {
      seen.push(`${request.method} ${request.path} ${request.query.get("state") ?? ""}`)
      return Promise.resolve({ status: 200, html: "<p>ok</p>" })
    })
    expect(server.port).toBeGreaterThan(0)
    const response = await fetch(`http://127.0.0.1:${server.port}/callback?state=s1`)
    expect(response.status).toBe(200)
    expect(await response.text()).toBe("<p>ok</p>")
    expect(Object.fromEntries(response.headers)).toMatchObject({
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
    })
    expect(seen).toEqual(["GET /callback s1"])
    await expect(fetch(`http://[::1]:${server.port}/callback`)).rejects.toThrow()
    await server.close()
    await expect(fetch(`http://127.0.0.1:${server.port}/callback`)).rejects.toThrow()
  })

  it("answers a failing handler with 500 and rejects a port in use with its code", async () => {
    const server = await runtime.listenLoopback(0, () => Promise.reject(new Error("boom")))
    expect((await fetch(`http://127.0.0.1:${server.port}/`)).status).toBe(500)
    const error: unknown = await runtime
      .listenLoopback(server.port, () => Promise.resolve({ status: 200, html: "" }))
      .then(
        () => undefined,
        (reason: unknown) => reason,
      )
    expect(error).toMatchObject({ code: "EADDRINUSE" })
    await server.close()
  })

  it("gives strong random bytes of the requested length, also beyond 64 KiB", () => {
    const first = runtime.randomBytes(32)
    expect(first).toHaveLength(32)
    expect(runtime.randomBytes(32)).not.toEqual(first)
    expect(runtime.randomBytes(70_000)).toHaveLength(70_000)
  })

  it("resolves a deadline after the delay", async () => {
    const started = Date.now()
    await runtime.deadline(20)
    expect(Date.now() - started).toBeGreaterThanOrEqual(15)
  })
})

describe("browserCommand", () => {
  const url = "https://login.example.com/auth?a=1&b=2"

  it("runs BROWSER as one executable with the URL as its only argument", () => {
    expect(browserCommand(url, { BROWSER: "/opt/my browser" }, "linux")).toEqual([
      "/opt/my browser",
      [url],
    ])
    expect(browserCommand(url, { BROWSER: " " }, "darwin")).toEqual(["open", [url]])
  })

  it("uses the platform opener, xdg-open only in a graphical session", () => {
    expect(browserCommand(url, {}, "win32")).toEqual([
      "rundll32.exe",
      ["url.dll,FileProtocolHandler", url],
    ])
    expect(browserCommand(url, {}, "linux")).toBeUndefined()
    expect(browserCommand(url, { DISPLAY: ":0" }, "linux")).toEqual(["xdg-open", [url]])
    expect(browserCommand(url, { WAYLAND_DISPLAY: "wayland-0" }, "freebsd")).toEqual([
      "xdg-open",
      [url],
    ])
  })

  it("starts nothing for non-http URLs or a missing browser, never throws", async () => {
    await expect(
      openBrowser("file:///etc/passwd", { BROWSER: "/bin/echo" }, "linux"),
    ).resolves.toBe(false)
    await expect(openBrowser(url, {}, "linux")).resolves.toBe(false)
    await expect(openBrowser(url, { BROWSER: "/nonexistent/browser" }, "linux")).resolves.toBe(
      false,
    )
  })

  it.skipIf(process.platform === "win32")("reports a started browser", async () => {
    await expect(openBrowser(url, { BROWSER: "true" }, "linux")).resolves.toBe(true)
  })
})

describe.skipIf(process.platform === "win32")("withLock and the file system", () => {
  let dir = ""
  const runtime = createNodeRuntime()

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "operate-lock-"))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it("serializes two holders and removes the lock afterwards", async () => {
    const path = join(dir, "a.lock")
    const events: string[] = []
    const hold = (name: string) =>
      runtime.withLock(path, 5_000, async () => {
        events.push(`${name} in`)
        await new Promise((resolve) => setTimeout(resolve, 30))
        events.push(`${name} out`)
        return name
      })
    await expect(Promise.all([hold("a"), hold("b")])).resolves.toEqual(["a", "b"])
    // either may win the race for the file; the holders never overlap
    expect([
      ["a in", "a out", "b in", "b out"],
      ["b in", "b out", "a in", "a out"],
    ]).toContainEqual(events)
    expect(await readdir(dir)).toEqual([])
  })

  it("writes the holder and its staleAt into a private lock file", async () => {
    const path = join(dir, "b.lock")
    await runtime.withLock(path, 7_000, async () => {
      const content = JSON.parse(await readFile(path, "utf8")) as { pid: number; staleAt: number }
      expect(content.pid).toBe(process.pid)
      expect(content.staleAt).toBeGreaterThan(Date.now() + 6_000)
      expect((await stat(path)).mode & 0o777).toBe(0o600)
    })
  })

  it("does not break a live holder's lock before its staleAt, whatever its own holdMs", async () => {
    const path = join(dir, "c.lock")
    const content = JSON.stringify({ pid: 1, staleAt: Date.now() + 60_000 })
    await writeFile(path, content)
    let ran = false
    await expect(
      runtime.withLock(path, 100, () => {
        ran = true
        return Promise.resolve()
      }),
    ).rejects.toThrow("Timed out after 200 ms waiting for the lock")
    expect(ran).toBe(false)
    expect(await readFile(path, "utf8")).toBe(content)
  })

  it("breaks a lock whose staleAt passed", async () => {
    const path = join(dir, "d.lock")
    await writeFile(path, JSON.stringify({ pid: 1, staleAt: Date.now() - 1 }))
    await expect(runtime.withLock(path, 1_000, () => Promise.resolve("taken"))).resolves.toBe(
      "taken",
    )
    expect(await readdir(dir)).toEqual([])
  })

  it("breaks an unreadable lock only once it is older than 60 s", async () => {
    const fresh = join(dir, "e.lock")
    await writeFile(fresh, "")
    await expect(runtime.withLock(fresh, 50, () => Promise.resolve())).rejects.toThrow()
    const old = join(dir, "f.lock")
    await writeFile(old, "{")
    const past = new Date(Date.now() - 120_000)
    await utimes(old, past, past)
    await expect(runtime.withLock(old, 1_000, () => Promise.resolve("taken"))).resolves.toBe(
      "taken",
    )
  })

  it("never removes the next holder's lock when an overrunning holder releases", async () => {
    const path = join(dir, "g.lock")
    let firstDone: () => void = () => undefined
    const released = new Promise<void>((resolve) => {
      firstDone = resolve
    })
    const first = runtime
      .withLock(path, 50, () => new Promise((resolve) => setTimeout(resolve, 200)))
      .then(firstDone)
    await new Promise((resolve) => setTimeout(resolve, 10))
    const second = runtime.withLock(path, 5_000, async () => {
      await released
      // the first holder released after its staleAt; this holder's lock must still be there
      return (JSON.parse(await readFile(path, "utf8")) as { staleAt: number }).staleAt
    })
    await first
    await expect(second).resolves.toBeGreaterThan(Date.now())
  })

  it("removes files, telling whether there was one, and creates directories with a mode", async () => {
    const file = join(dir, "x.json")
    await writeFile(file, "{}")
    await expect(runtime.fs.remove(file)).resolves.toBe(true)
    await expect(runtime.fs.remove(file)).resolves.toBe(false)
    const tokens = join(dir, "operate", "tokens")
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
    dir = await mkdtemp(join(tmpdir(), "operate-scan-"))
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

  it("owns what the current user created, a link itself included; nothing that is missing", async () => {
    await mkdir(join(dir, ".git"))
    await symlink(join(dir, ".git"), join(dir, "linked"))
    await expect(fs.ownedByUser?.(join(dir, ".git"))).resolves.toBe(true)
    await expect(fs.ownedByUser?.(join(dir, "linked"))).resolves.toBe(true)
    await expect(fs.ownedByUser?.(join(dir, "missing"))).resolves.toBe(false)
    // the file system root belongs to root, not to the user running the tests
    if (process.getuid?.() !== 0) await expect(fs.ownedByUser?.("/")).resolves.toBe(false)
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
