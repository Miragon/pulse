import { describe, expect, it } from "vitest"
import { portOf } from "../../test/support/engine-port.js"
import type { FakeServer } from "../../test/support/fake-fetch.js"
import { fakeRuntime, type FakeRuntimeOptions } from "../../test/support/fake-runtime.js"
import { PLAN_PATH, planEngine, sentRoutes } from "../../test/support/plan-migration-engine.js"
import type { FileSystem } from "../runtime.js"
import { planMigration, type PlanMigrationOptions } from "./plan-migration.js"

const BASE: PlanMigrationOptions = {
  key: "invoice",
  source: 1,
  target: 2,
  map: [],
  unmap: [],
  dryRun: false,
}
const LOOKUPS = ["GET /process-definition", "GET /process-definition"]
const OWN = "plans/invoice.migration.json"
/** The hints of a failing file system call: the default path is pulse's, --plan-file the user's. */
const DEFAULT_FAILURE = "Check the folder's permissions, or name another path with --plan-file."
const OWN_FAILURE = "Check --plan-file and the folder's permissions."

function setup(
  files: FakeRuntimeOptions = {},
  change: (fs: FileSystem) => FileSystem = (fs) => fs,
  server: FakeServer = planEngine(),
) {
  const runtime = fakeRuntime(files)
  const deps = { port: portOf(server.fetch), fs: change(runtime.fs) }
  return {
    server,
    runtime,
    run: (options: Partial<PlanMigrationOptions> = {}) =>
      planMigration(deps, { ...BASE, ...options }),
  }
}

const MOVE = "Move it out of the way, or name another path with --plan-file."

describe("planMigration command line", () => {
  it.each([
    [
      { key: "invoice:1:def-1" },
      '<key> "invoice:1:def-1" must be a BPMN process id: letters, digits, _, . or -, starting with a letter or _, at most 255 characters',
      "Pass the process definition key, not a definition id; pulse process-definition list lists them.",
    ],
    [
      { source: 0 },
      '<source> "0" must be a version number from 1 to 2147483647',
      "List the versions with: pulse process-definition list --key invoice",
    ],
    [
      { target: -2 },
      '<target> "-2" must be a version number from 1 to 2147483647',
      "List the versions with: pulse process-definition list --key invoice",
    ],
    [
      { target: 1 },
      "<source> and <target> are both version 1",
      "Name the version to migrate to, or leave <target> out for the latest.",
    ],
    [
      { planFile: "plans/invoice.json" },
      "--plan-file plans/invoice.json must end in .migration.json",
      "Pulse for VS Code edits files ending in .migration.json, e.g. --plan-file plans/invoice.migration.json.",
    ],
    [
      { planFile: "plans/.migration.json" },
      "--plan-file plans/.migration.json must end in .migration.json",
      "Pulse for VS Code edits files ending in .migration.json, e.g. --plan-file plans/invoice.migration.json.",
    ],
    [
      { map: ["check"] },
      '--map expects <source>=<target>, got "check"',
      "Name element ids of the BPMN models, e.g. --map Activity_CheckOrder=Activity_Review",
    ],
  ])("refuses %o before any request", async (options, message, hint) => {
    const { server, run } = setup()
    await expect(run({ ...options, dryRun: true })).rejects.toMatchObject({
      code: "USAGE",
      exitCode: 2,
      message,
      details: { hint },
    })
    expect(server.requests).toEqual([])
  })
})

describe("planMigration plan file", () => {
  it.each([
    [PLAN_PATH, `${PLAN_PATH} is a symbolic link; pulse writes no plan file through one`],
    [".pulse", ".pulse is a symbolic link; pulse writes no plan file through one"],
    [
      ".pulse/migrations",
      ".pulse/migrations is a symbolic link; pulse writes no plan file through one",
    ],
  ])("refuses the link %s on the default path before the proposal", async (link, message) => {
    const { server, run, runtime } = setup({ links: [link], files: { [PLAN_PATH]: "old" } })
    await expect(run()).rejects.toMatchObject({ code: "USAGE", message, details: { hint: MOVE } })
    expect(sentRoutes(server)).toEqual(LOOKUPS)
    expect(runtime.dirs.has(".pulse/migrations")).toBe(false)
  })

  it("refuses a directory or another entry at the default path before the proposal", async () => {
    const directory = setup({ dirs: [PLAN_PATH] })
    await expect(directory.run()).rejects.toMatchObject({
      code: "USAGE",
      message: `${PLAN_PATH} is a directory`,
    })
    expect(sentRoutes(directory.server)).toEqual(LOOKUPS)
    const other = setup({ others: [PLAN_PATH] })
    await expect(other.run()).rejects.toMatchObject({
      message: `${PLAN_PATH} is not a regular file`,
      details: { hint: MOVE },
    })
  })

  it("refuses --plan-file at a link, a directory or in a missing folder before any request", async () => {
    const link = setup({ dirs: ["plans"], links: [OWN] })
    await expect(link.run({ planFile: OWN })).rejects.toMatchObject({
      message: `${OWN} is a symbolic link; pulse writes no plan file through one`,
    })
    expect(link.server.requests).toEqual([])
    await expect(setup({ dirs: [OWN] }).run({ planFile: OWN })).rejects.toMatchObject({
      message: `${OWN} is a directory`,
    })
    const missing = setup()
    await expect(missing.run({ planFile: OWN })).rejects.toMatchObject({
      code: "USAGE",
      message: "The folder plans of --plan-file does not exist",
      details: { hint: "Create it first, or name a path in a folder that exists." },
    })
    expect(missing.server.requests).toEqual([])
    const inFile = setup({ files: { plans: "a file" } })
    await expect(inFile.run({ planFile: OWN })).rejects.toMatchObject({
      message: "The folder plans of --plan-file does not exist",
    })
  })

  it("follows a link of a folder of --plan-file, which the user named", async () => {
    const { run, runtime } = setup({ dirs: ["plans"], links: ["plans"] })
    await run({ planFile: OWN })
    expect(runtime.files.has(OWN)).toBe(true)
    const root = setup({ dirs: ["/"] })
    await root.run({ planFile: "/invoice.migration.json" })
    expect(root.runtime.files.has("/invoice.migration.json")).toBe(true)
  })

  it("checks for a link again right before the write", async () => {
    let checks = 0
    const { run, runtime } = setup({}, (fs) => ({
      ...fs,
      linked: (path) => Promise.resolve(path === PLAN_PATH && ++checks > 1),
    }))
    await expect(run()).rejects.toMatchObject({
      message: `${PLAN_PATH} is a symbolic link; pulse writes no plan file through one`,
    })
    expect(runtime.files.has(PLAN_PATH)).toBe(false)
  })

  it.each([
    ["mkdir", "EACCES: permission denied, mkdir '.pulse'"],
    ["writeFile", "EACCES: permission denied, open 'x'"],
  ] as const)("words a failing %s as USAGE", async (method, reason) => {
    const { run } = setup({}, (fs) => ({
      ...fs,
      [method]: () => Promise.reject(new Error(reason)),
    }))
    await expect(run()).rejects.toMatchObject({
      code: "USAGE",
      message: `Cannot write ${PLAN_PATH}: ${reason}`,
      details: { hint: DEFAULT_FAILURE },
    })
  })

  it("words a failing write of --plan-file with a hint at --plan-file", async () => {
    const reason = "EACCES: permission denied, open 'plans/invoice.migration.json'"
    const { run } = setup({ dirs: ["plans"] }, (fs) => ({
      ...fs,
      writeFile: () => Promise.reject(new Error(reason)),
    }))
    await expect(run({ planFile: OWN })).rejects.toMatchObject({
      code: "USAGE",
      message: `Cannot write ${OWN}: ${reason}`,
      details: { hint: OWN_FAILURE },
    })
  })
})

/** Node's words for `method` (lstat or stat) on a path in a folder the user may not read. */
function deniedText(method: "linked" | "kind", path: string): string {
  return `EACCES: permission denied, ${method === "linked" ? "lstat" : "stat"} '${path}'`
}

/** A file system whose `method` fails from its call after `after` on, like Node's would. */
function denied(method: "linked" | "kind", after = 0): (fs: FileSystem) => FileSystem {
  return (fs) => {
    let calls = 0
    const fail = (path: string) =>
      Promise.reject(Object.assign(new Error(deniedText(method, path)), { code: "EACCES" }))
    return {
      ...fs,
      [method]: (path: string) => (++calls > after ? fail(path) : fs[method](path)),
    }
  }
}

describe("planMigration plan file failures", () => {
  it.each([
    ["linked", ".pulse"],
    ["kind", PLAN_PATH],
  ] as const)(
    "words a failing %s of the default path (%s) as USAGE, exit 2, before the proposal",
    async (method, failing) => {
      const { server, run } = setup({}, denied(method))
      await expect(run()).rejects.toMatchObject({
        code: "USAGE",
        exitCode: 2,
        message: `Cannot write ${PLAN_PATH}: ${deniedText(method, failing)}`,
        details: { hint: DEFAULT_FAILURE },
      })
      expect(sentRoutes(server)).toEqual(LOOKUPS)
    },
  )

  it.each([
    ["linked", 0, OWN],
    ["kind", 0, OWN],
    ["kind", 1, "plans"],
  ] as const)(
    "words a failing %s (after %i calls, of %s) of --plan-file as USAGE, exit 2, before any request",
    async (method, after, failing) => {
      const { server, run } = setup({ dirs: ["plans"] }, denied(method, after))
      await expect(run({ planFile: OWN })).rejects.toMatchObject({
        code: "USAGE",
        exitCode: 2,
        message: `Cannot write ${OWN}: ${deniedText(method, failing)}`,
        details: { hint: OWN_FAILURE },
      })
      expect(server.requests).toEqual([])
    },
  )

  it.each([
    ["linked", 3, ".pulse"],
    ["kind", 1, PLAN_PATH],
  ] as const)(
    "words a failing %s right before the write as USAGE and writes nothing",
    async (method, after, failing) => {
      const { server, run, runtime } = setup({}, denied(method, after))
      await expect(run()).rejects.toMatchObject({
        code: "USAGE",
        exitCode: 2,
        message: `Cannot write ${PLAN_PATH}: ${deniedText(method, failing)}`,
        details: { hint: DEFAULT_FAILURE },
      })
      expect(sentRoutes(server)).toContain("POST /migration/validate")
      expect(runtime.files.has(PLAN_PATH)).toBe(false)
    },
  )

  it.each([
    ["a".repeat(240), 264],
    ["ä".repeat(120), 264],
    ["a".repeat(232), 256],
  ])(
    "refuses a default file name over 255 bytes after the lookups, before the proposal",
    async (key, bytes) => {
      const { server, run, runtime } = setup()
      const name = `${key}-v1-to-v2.migration.json`
      await expect(run({ key })).rejects.toMatchObject({
        code: "USAGE",
        exitCode: 2,
        message: `The default file name ${name} has ${String(bytes)} bytes; file systems hold at most 255`,
        details: { hint: "Name a shorter path with --plan-file." },
      })
      expect(sentRoutes(server)).toEqual(LOOKUPS)
      expect(runtime.dirs.has(".pulse/migrations")).toBe(false)
    },
  )

  it("writes a default file name of exactly 255 bytes, and a long key with --plan-file", async () => {
    const key = "a".repeat(231)
    const { run, runtime } = setup()
    await run({ key })
    expect(runtime.files.has(`.pulse/migrations/${key}-v1-to-v2.migration.json`)).toBe(true)
    const own = setup({ dirs: ["plans"] })
    await own.run({ key: "a".repeat(240), planFile: OWN })
    expect(own.runtime.files.has(OWN)).toBe(true)
  })
})
