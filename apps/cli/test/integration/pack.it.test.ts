/**
 * Smoke test of the published artifact: `npm pack` of the bundle the build put into `dist/` (as the
 * publish workflow packs it: build first, no prepack script), install the tarball into a temporary
 * global prefix and run the installed `pulse-cli` binary.
 *
 * The pack runs in a copy of the package tree, so nothing it writes lands next to the `dist/` the
 * engine suites execute in parallel.
 */

import { existsSync } from "node:fs"
import { cp, mkdir, readdir, readFile, symlink } from "node:fs/promises"
import { join, relative, sep } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { REPO_ROOT } from "./support/cli.js"
import { cleanEnv, describeResult, type ProcessResult, runProcess } from "./support/process.js"
import { makeTempDir, removeTempDir } from "./support/temp.js"

const SKIP_ENV = "PULSE_CLI_IT_SKIP_PACK"
const PACKAGE_NAME = "@miragon/pulse-cli"
const BIN_NAME = "pulse-cli"
const SETUP_TIMEOUT_MS = 300_000
const NPM_TIMEOUT_MS = 240_000
const IS_WINDOWS = process.platform === "win32"
const NPM = IS_WINDOWS ? "npm.cmd" : "npm"
/** Top-level entries of the working tree that the pack does not need. */
const NOT_COPIED = new Set([
  "node_modules",
  ".git",
  "build",
  "coverage",
  "reports",
  ".stryker-tmp",
  ".context",
  ".claude",
])

function expectSuccess(result: ProcessResult): ProcessResult {
  expect(result.code, describeResult(result)).toBe(0)
  return result
}

function ensureSuccess(result: ProcessResult): ProcessResult {
  if (result.code !== 0) throw new Error(`Command failed\n${describeResult(result)}`)
  return result
}

/** Copies the working tree without build output and dependencies; links node_modules back. */
async function copyWorkingTree(target: string): Promise<void> {
  await cp(REPO_ROOT, target, {
    recursive: true,
    filter: (source) => {
      const [top = ""] = relative(REPO_ROOT, source).split(sep)
      return !NOT_COPIED.has(top) && !source.endsWith(".tgz")
    },
  })
  await symlink(join(REPO_ROOT, "node_modules"), join(target, "node_modules"), "junction")
}

async function packTarball(source: string, destination: string): Promise<string> {
  ensureSuccess(
    await runProcess(NPM, ["pack", "--pack-destination", destination], {
      cwd: source,
      timeoutMs: NPM_TIMEOUT_MS,
    }),
  )
  const tarballs = (await readdir(destination)).filter((name) => name.endsWith(".tgz"))
  if (tarballs.length !== 1) {
    throw new Error(`Expected one tarball in ${destination}, found: ${tarballs.join(", ")}`)
  }
  return join(destination, tarballs[0] ?? "")
}

async function installGlobally(tarball: string, prefix: string, cwd: string): Promise<void> {
  const args = [
    "install",
    "--global",
    "--prefix",
    prefix,
    "--no-audit",
    "--no-fund",
    "--prefer-offline",
  ]
  ensureSuccess(await runProcess(NPM, [...args, tarball], { cwd, timeoutMs: NPM_TIMEOUT_MS }))
}

function installedPackageDir(prefix: string): string {
  const modules = IS_WINDOWS ? join(prefix, "node_modules") : join(prefix, "lib", "node_modules")
  return join(modules, ...PACKAGE_NAME.split("/"))
}

function installedBin(prefix: string): string {
  return IS_WINDOWS ? join(prefix, `${BIN_NAME}.cmd`) : join(prefix, "bin", BIN_NAME)
}

describe("packed npm tarball", () => {
  if (process.env[SKIP_ENV] === "1") {
    it("is skipped", (context) => {
      context.skip(`${SKIP_ENV}=1 is set, so the packed tarball smoke test does not run`)
    })
    return
  }

  let workdir: string | undefined
  let prefix = ""

  const pulseCli = (args: readonly string[]) =>
    runProcess(installedBin(prefix), args, {
      cwd: workdir ?? REPO_ROOT,
      env: cleanEnv({ XDG_CONFIG_HOME: workdir }),
    })

  beforeAll(async () => {
    workdir = await makeTempDir("pulse-cli-it-pack-")
    const tree = join(workdir, "tree")
    const packDir = join(workdir, "pack")
    prefix = join(workdir, "prefix")
    await copyWorkingTree(tree)
    await mkdir(packDir, { recursive: true })
    const tarball = await packTarball(tree, packDir)
    await installGlobally(tarball, prefix, workdir)
  }, SETUP_TIMEOUT_MS)

  afterAll(async () => {
    await removeTempDir(workdir)
  })

  it("installs the bundle without sources", () => {
    const packageDir = installedPackageDir(prefix)
    expect(existsSync(join(packageDir, "dist", "pulse-cli.js"))).toBe(true)
    expect(existsSync(join(packageDir, "src"))).toBe(false)
    expect(existsSync(join(packageDir, "test"))).toBe(false)
    expect(existsSync(installedBin(prefix))).toBe(true)
  })

  it("installs exactly one command, pulse-cli: an operate bin would collide with the old package", async () => {
    const bins = IS_WINDOWS
      ? (await readdir(prefix)).filter((name) => name !== "node_modules")
      : await readdir(join(prefix, "bin"))
    expect(bins.sort()).toEqual(
      IS_WINDOWS ? [BIN_NAME, `${BIN_NAME}.cmd`, `${BIN_NAME}.ps1`] : [BIN_NAME],
    )
  })

  it("ships the README, the license and the agent skill", async () => {
    const packageDir = installedPackageDir(prefix)
    for (const file of ["README.md", "LICENSE", join("skills", "pulse-cli", "SKILL.md")]) {
      expect(existsSync(join(packageDir, file)), file).toBe(true)
    }
    const skill = await readFile(join(packageDir, "skills", "pulse-cli", "SKILL.md"), "utf8")
    expect(skill).toMatch(/^---\nname: pulse-cli\n/)
    expect(await readFile(join(packageDir, "README.md"), "utf8")).toContain("pulse-cli")
  })

  it("ships the Claude Code plugin of the skill without its evals", () => {
    const pluginDir = join(installedPackageDir(prefix), "skills", "pulse-cli")
    for (const file of [join(".claude-plugin", "plugin.json"), join("commands", "status.md")]) {
      expect(existsSync(join(pluginDir, file)), file).toBe(true)
    }
    expect(existsSync(join(pluginDir, "evals"))).toBe(false)
  })

  it("prints the package version", async () => {
    const manifest = JSON.parse(await readFile(join(REPO_ROOT, "package.json"), "utf8")) as {
      version: string
    }
    const result = expectSuccess(await pulseCli(["--version"]))
    expect(result.stdout.trim()).toBe(manifest.version)
  })

  it("lists the command groups", async () => {
    const result = expectSuccess(await pulseCli(["commands"]))
    const groups = JSON.parse(result.stdout) as unknown
    expect(groups).toContainEqual(expect.objectContaining({ group: "process-instance" }))
  })

  it("prints the shell completion scripts and completes from the installed bin", async () => {
    const script = expectSuccess(await pulseCli(["completion", "bash"]))
    expect(script.stdout).toContain("complete -o nospace -F _pulse_cli_complete pulse-cli")
    const candidates = expectSuccess(await pulseCli(["__complete", "proc"]))
    const values = candidates.stdout.split("\n").map((line) => line.split("\t")[0])
    expect(values).toEqual(expect.arrayContaining(["process-definition", "process-instance"]))
    expect(candidates.stderr).toBe("")
  })

  it("prints the agent guide, the body of the skill, and its topics", async () => {
    const result = expectSuccess(await pulseCli(["guide"]))
    expect(result.stdout).toMatch(/^# pulse-cli: /)
    const skillPath = join(installedPackageDir(prefix), "skills", "pulse-cli", "SKILL.md")
    expect((await readFile(skillPath, "utf8")).endsWith(`\n---\n\n${result.stdout}`)).toBe(true)
    const list = expectSuccess(await pulseCli(["guide", "--list"]))
    const topics = (JSON.parse(list.stdout) as { topic: string }[]).map(({ topic }) => topic)
    expect(topics).toEqual(expect.arrayContaining(["workflow", "auth", "recipes"]))
    const docsDir = join(REPO_ROOT, "..", "..", "docs", "cli")
    const docsPages = await Promise.all(
      (await readdir(docsDir))
        .filter((name) => name.endsWith(".md"))
        .map(async (name) => (await readFile(join(docsDir, name), "utf8")).trimEnd()),
    )
    for (const topic of topics) {
      const page = expectSuccess(await pulseCli(["guide", topic]))
      expect(docsPages, topic).toContain(page.stdout.trimEnd())
      expect(result.stdout).toContain(`\n- \`${topic}\`: `)
    }
  })
})
