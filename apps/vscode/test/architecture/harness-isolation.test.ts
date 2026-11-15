import { execFileSync } from "node:child_process"
import { existsSync, globSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join, relative } from "node:path"
import { pathToFileURL } from "node:url"
import { describe, expect, test } from "vitest"
import { APP_ROOT, REPO_ROOT } from "./support/files.js"

interface ConfigHome {
  readonly XDG_CONFIG_HOME?: string | undefined
  readonly APPDATA?: string | undefined
  readonly PULSE_CLI_CONFIG?: string | undefined
}

interface Helpers {
  readonly isolatedConfigHome: () => ConfigHome
  readonly keptConfigHome: (name: string) => ConfigHome
}

const SPREAD =
  /env:\s*\{\s*\.\.\.process\.env,\s*\.\.\.(?:isolatedConfigHome\(\)|keptConfigHome\("[\w-]+"\))\s*\}/
const LAUNCHES = /electron\.launch\(|spawn\(process\.execPath|execFileSync\(\s*"code"/
const STARTS_VS_CODE = "electron.launch("
const NO_SHELL_ENVIRONMENT = "--force-disable-user-env"
const CONTAINER = [
  /`XDG_CONFIG_HOME=\$\{CONTAINER_CONFIG_HOME\}`/,
  /`APPDATA=\$\{CONTAINER_CONFIG_HOME\}`/,
  /"PULSE_CLI_CONFIG="/,
]
const SCRIPTS = "apps/vscode/scripts/**/*.mjs"
const LAUNCHERS = [
  "apps/vscode/scripts/e2e.mjs",
  "apps/vscode/scripts/dev-server.mjs",
  "apps/vscode/scripts/sandbox/sandbox.mjs",
  "apps/vscode/scripts/screenshots/vscode-driver.mjs",
]
const JOURNEYS = ".miragon/shots/*.mjs"
const DRIVER = "scripts/screenshots/vscode-driver.mjs"

function launchesUnisolated(source: string): boolean {
  const keepsTheEnvironment = LAUNCHES.test(source) && !SPREAD.test(source)
  const takesTheShellEnvironment =
    source.includes(STARTS_VS_CODE) && !source.includes(`"${NO_SHELL_ENVIRONMENT}"`)
  return keepsTheEnvironment || takesTheShellEnvironment
}

function sourceOf(path: string): string {
  return readFileSync(join(REPO_ROOT, path), "utf8")
}

function isIsolated(home: ConfigHome): boolean {
  const folder = home.XDG_CONFIG_HOME ?? ""
  return (
    folder === home.APPDATA &&
    home.PULSE_CLI_CONFIG === "" &&
    !relative(tmpdir(), folder).startsWith("..") &&
    !folder.startsWith(join(homedir(), ".config")) &&
    statSync(folder).isDirectory()
  )
}

const HELPERS = pathToFileURL(join(APP_ROOT, "scripts/support/config-home.mjs")).href

interface EndedRun {
  readonly folder: string
  readonly whileRunning: boolean
}

async function helpers(): Promise<Helpers> {
  return (await import(HELPERS)) as Helpers
}

function endedRun(): EndedRun {
  const script = [
    'import { existsSync } from "node:fs"',
    `import { isolatedConfigHome } from ${JSON.stringify(HELPERS)}`,
    "const folder = isolatedConfigHome().XDG_CONFIG_HOME",
    "process.stdout.write(JSON.stringify({ folder, whileRunning: existsSync(folder) }))",
  ].join("\n")
  const output = execFileSync(process.execPath, ["--input-type=module", "--eval", script], {
    encoding: "utf8",
  })
  return JSON.parse(output) as EndedRun
}

function removeAll(homes: readonly ConfigHome[]): void {
  for (const home of homes) {
    rmSync(home.XDG_CONFIG_HOME ?? "", { recursive: true, force: true })
  }
}

interface SmokeLaunch {
  readonly env?: ConfigHome
  readonly launchArgs?: readonly string[]
}

async function smokeLaunches(): Promise<readonly SmokeLaunch[]> {
  const loaded = (await import(pathToFileURL(join(APP_ROOT, ".vscode-test.mjs")).href)) as {
    readonly default: readonly SmokeLaunch[]
  }
  return loaded.default
}

describe("every VS Code a harness starts reads the CLI config of a temporary folder", () => {
  test("is a fresh temporary folder for each start, on Linux, macOS and Windows alike, with PULSE_CLI_CONFIG blank", async () => {
    const { isolatedConfigHome } = await helpers()
    const [first, second] = [isolatedConfigHome(), isolatedConfigHome()]

    expect(isIsolated(first)).toBe(true)
    expect(isIsolated(second)).toBe(true)
    expect(first.XDG_CONFIG_HOME).not.toBe(second.XDG_CONFIG_HOME)
    removeAll([first, second])
  })

  test("is removed when the run that made it ends", () => {
    const { folder, whileRunning } = endedRun()

    expect(whileRunning).toBe(true)
    expect(existsSync(folder)).toBe(false)
  })

  test("is kept for the sandbox window, which outlives the script that opens it", async () => {
    const { keptConfigHome } = await helpers()
    const name = relative(tmpdir(), mkdtempSync(join(tmpdir(), "pulse-kept-")))
    try {
      const [first, second] = [keptConfigHome(name), keptConfigHome(name)]
      expect(isIsolated(first)).toBe(true)
      expect(second).toEqual(first)
    } finally {
      rmSync(join(tmpdir(), name), { recursive: true, force: true })
    }
  })

  test("holds for the unit tests, which never read or write the CLI config of whoever runs them", () => {
    expect(
      isIsolated({
        XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
        APPDATA: process.env.APPDATA,
        PULSE_CLI_CONFIG: process.env.PULSE_CLI_CONFIG,
      }),
    ).toBe(true)
  })

  test("holds for each launch of the smoke test, which takes nothing from the shell's environment", async () => {
    const launches = await smokeLaunches()
    const homes = launches.map((launch) => launch.env ?? {})

    expect(launches.every((launch) => launch.launchArgs?.includes(NO_SHELL_ENVIRONMENT))).toBe(true)
    expect(homes.length).toBeGreaterThan(1)
    expect(homes.every(isIsolated)).toBe(true)
    expect(new Set(homes.map((home) => home.XDG_CONFIG_HOME)).size).toBe(homes.length)
    removeAll(homes)
  })

  test("holds for e2e, the screenshots, the dev host and the sandbox window", () => {
    for (const path of LAUNCHERS) {
      expect(SPREAD.test(sourceOf(path)), path).toBe(true)
    }
  })

  test("holds for the suites in Docker", () => {
    const source = sourceOf("apps/vscode/scripts/docker-test.mjs")
    expect(CONTAINER.every((setting) => setting.test(source))).toBe(true)
  })

  test("holds for every script that starts VS Code or the dev host, and the journeys start it through the driver", () => {
    const scripts = globSync(SCRIPTS, { cwd: REPO_ROOT })
    const launching = scripts.filter((path) => LAUNCHES.test(sourceOf(path))).sort()
    expect(launching).toEqual([...LAUNCHERS].sort())
    expect(scripts.filter((path) => launchesUnisolated(sourceOf(path)))).toEqual([])
    const journeys = globSync(JOURNEYS, { cwd: REPO_ROOT })
      .map(sourceOf)
      .filter((source) => source.includes("launchVsCode("))
    expect(journeys.length).toBeGreaterThan(0)
    expect(journeys.every((source) => source.includes(DRIVER))).toBe(true)
  })

  test("bites on a launch that keeps the environment of the person who runs it, their shell's included", () => {
    expect(launchesUnisolated("await electron.launch({ executablePath, args })")).toBe(true)
    expect(launchesUnisolated("spawn(process.execPath, [OUTFILE], { env: process.env })")).toBe(
      true,
    )
    expect(launchesUnisolated('execFileSync("code", [folder])')).toBe(true)
    expect(
      launchesUnisolated(
        "electron.launch({ env: { ...process.env, ...isolatedConfigHome() }, args: [folder] })",
      ),
    ).toBe(true)
    expect(
      launchesUnisolated(
        'electron.launch({ env: { ...process.env, ...isolatedConfigHome() }, args: ["--force-disable-user-env"] })',
      ),
    ).toBe(false)
  })

  test("bites on a config home that lets an inherited PULSE_CLI_CONFIG through", () => {
    const folder = mkdtempSync(join(tmpdir(), "pulse-planted-"))
    try {
      expect(isIsolated({ XDG_CONFIG_HOME: folder, APPDATA: folder })).toBe(false)
      expect(isIsolated({ XDG_CONFIG_HOME: folder, APPDATA: folder, PULSE_CLI_CONFIG: "" })).toBe(
        true,
      )
    } finally {
      rmSync(folder, { recursive: true, force: true })
    }
  })
})
