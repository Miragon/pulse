#!/usr/bin/env node
/**
 * The local commands from a fresh clone (root package.json): `pnpm stack:up|down|status` run the
 * playground in Docker, `pnpm play` runs the MCP server against it, `pnpm play:cli` the CLI,
 * `pnpm test:one` test files in their packages, `pnpm check` and `pnpm check:all` the local bar.
 * Node built-ins only, so it starts before `pnpm install`. Needs Node, pnpm and Docker; no JDK
 * (Gradle runs in a container without one).
 *
 * Portability: child processes start without a shell. pnpm runs through the pnpm that started
 * this script (npm_execpath: its .js entry under node, or its native binary), docker and git as
 * executables; on Windows, gradlew.bat goes through
 * cmd.exe, a stopped server's process tree through taskkill, and check:all's template step needs
 * a bash on the PATH (Git Bash). Only macOS and Linux are tested.
 */
import { execFile, spawn } from "node:child_process"
import {
  closeSync,
  existsSync,
  writeSync,
  mkdirSync,
  openSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
} from "node:fs"
import net from "node:net"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs, USAGE } from "./local-args.mjs"
import {
  CHECK_LOG_DIR,
  checkSteps,
  checkSummary,
  formatDuration,
  logName,
  outcomeOf,
  stepLine,
} from "./local-check.mjs"
import {
  cliPreset,
  COMPOSE_FILE,
  COMPOSE_PROJECT,
  composeArgs,
  portConflict,
  portOwners,
  profilesFor,
  SERVICES,
  serverPreset,
  servicesFor,
  withPreset,
} from "./local-env.mjs"
import {
  describeJdk,
  ENGINE_JAR,
  ENGINE_JAR_SOURCES,
  gradleCommand,
  jarIsStale,
  parseJavaMajor,
  pickJdk,
  staleJarNote,
} from "./local-gradle.mjs"
import { realpathOnDisk, testOnePlan } from "./local-test-one.mjs"
import { readWorkspace } from "./workspace-packages.mjs"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const SERVER_PACKAGE = "@miragon/pulse-mcp-server"
const CLI_PACKAGE = "@miragon/pulse-cli"
const CLI_ENTRY = "apps/cli/dist/pulse-cli.js"
const STACK_TIMEOUT_MS = 10 * 60_000
const SERVER_TIMEOUT_MS = 3 * 60_000
/** The MCP server's port when PORT is unset (the `dev` script's default). */
const DEFAULT_PORT = 8400
/** Served by `mcp-use dev` only. */
const INSPECTOR = "/mcp/inspector"

class Failure extends Error {}

/**
 * Progress goes to stderr. pnpm itself prints the script banner to stdout, so the CLI's output
 * is the whole stdout only under `pnpm -s play:cli -- <args>`.
 */
const say = (line) => console.error(line)

/**
 * `[command, ...args]` for pnpm: the pnpm that runs this script, without a shell. npm_execpath
 * is its .js entry (run under node) or its native binary (@pnpm/exe, run as is); one that is
 * not pnpm's (npm run) falls back to the pnpm on the PATH.
 */
function pnpmArgv(args) {
  const execPath = process.env.npm_execpath
  if (execPath && /pnpm/i.test(path.basename(execPath))) {
    return /\.c?js$/.test(execPath) ? [process.execPath, execPath, ...args] : [execPath, ...args]
  }
  if (process.platform === "win32") {
    throw new Failure("Run this through pnpm (pnpm play, pnpm check, ...), not with node directly.")
  }
  return ["pnpm", ...args]
}

/** A step or command as `[command, ...args]`, pnpm resolved. */
const argvOf = ({ command, args }) => (command === "pnpm" ? pnpmArgv(args) : [command, ...args])

/** Run to the end; resolves the exit code (a signal counts as 1). */
function run(argv, { cwd = ROOT, env = process.env, stdio = "inherit" } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(argv[0], argv.slice(1), { cwd, env, stdio })
    child.on("error", (error) =>
      reject(
        error.code === "ENOENT"
          ? new Failure(`${argv[0]} is not installed or not on the PATH`)
          : error,
      ),
    )
    child.on("exit", (code) => resolve(code ?? 1))
  })
}

/** Run and fail on a non-zero exit. Helper output goes to stderr. */
async function must(argv, what, options = {}) {
  const code = await run(argv, { stdio: ["ignore", 2, 2], ...options })
  if (code !== 0) throw new Failure(`${what} failed (exit ${code}).`)
}

/** stdout of a command, or undefined when it fails. */
const capture = (command, args) =>
  new Promise((resolve) => {
    execFile(command, args, { cwd: ROOT, timeout: 30_000 }, (error, stdout, stderr) =>
      resolve(error ? undefined : `${stdout}${stderr}`),
    )
  })

/** Whether `url` answers 200 within two seconds. */
const answers = (url) =>
  fetch(url, { signal: AbortSignal.timeout(2000), redirect: "manual" }).then(
    (response) => response.status === 200,
    () => false,
  )

/** Whether something listens on the loopback port. */
const portBound = (port) =>
  new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port, timeout: 1000 })
    const done = (bound) => {
      socket.destroy()
      resolve(bound)
    }
    socket.on("connect", () => done(true))
    socket.on("timeout", () => done(false))
    socket.on("error", () => done(false))
  })

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitFor(label, check, timeoutMs) {
  const start = Date.now()
  while (!(await check())) {
    if (Date.now() - start > timeoutMs) {
      throw new Failure(`${label} did not answer within ${formatDuration(timeoutMs)}.`)
    }
    await sleep(2000)
  }
  return Date.now() - start
}

// ── Docker and the stack ────────────────────────────────────────────────────

const dockerRunning = async () =>
  (await capture("docker", ["info", "--format", "{{.ServerVersion}}"])) !== undefined

async function ensureDocker() {
  if (!(await dockerRunning())) {
    throw new Failure("Docker is not running (or not installed). Start Docker and try again.")
  }
}

const dockerPs = async () =>
  portOwners(
    (await capture("docker", [
      "ps",
      "--format",
      '{{.Names}}\t{{.Label "com.docker.compose.project"}}\t{{.Ports}}',
    ])) ?? "",
  )

const compose = (profiles, ...command) => [
  "docker",
  ...composeArgs(path.join(ROOT, COMPOSE_FILE), profiles, ...command),
]

/** The newest mtime under `rel` (a file or a directory tree), 0 when it is missing. */
function newestMtime(rel) {
  const abs = path.join(ROOT, rel)
  if (!existsSync(abs)) return 0
  const stat = statSync(abs)
  if (!stat.isDirectory()) return stat.mtimeMs
  return Math.max(
    stat.mtimeMs,
    ...readdirSync(abs).map((entry) => newestMtime(path.join(rel, entry))),
  )
}

/** Where Gradle runs on this machine. */
async function detectJdk(forceContainer) {
  const javaHome = process.env.JAVA_HOME
  const javaBin = (home) =>
    path.join(home, "bin", process.platform === "win32" ? "java.exe" : "java")
  const javaHomeMajor = javaHome
    ? parseJavaMajor(await capture(javaBin(javaHome), ["-version"]))
    : undefined
  const macHome =
    process.platform === "darwin"
      ? (await capture("/usr/libexec/java_home", ["-v", "21"]))?.trim().split("\n").at(-1)
      : undefined
  // java_home may fall back to another version; only a real JDK 21 counts.
  const macJdk21 =
    macHome && parseJavaMajor(await capture(javaBin(macHome), ["-version"])) === 21
      ? macHome
      : undefined
  const pathMajor = parseJavaMajor(await capture("java", ["-version"]))
  return pickJdk({
    forceContainer,
    javaHome,
    javaHomeMajor,
    macJdk21: macJdk21 && existsSync(macJdk21) ? macJdk21 : undefined,
    pathMajor,
  })
}

/** `[argv, { cwd, env }]` for a Gradle build on this machine. */
async function gradleRun({ project, tasks }, forceContainer) {
  const jdk = await detectJdk(forceContainer)
  if (jdk.kind === "container") await ensureDocker()
  const { command, args, cwd, env } = gradleCommand(jdk, {
    repoRoot: ROOT,
    project,
    tasks,
    platform: process.platform,
    uid: process.getuid?.(),
    gid: process.getgid?.(),
  })
  return { jdk, argv: [command, ...args], cwd, env: { ...process.env, ...env } }
}

/** The engine jar's mtime (undefined when missing) and whether it needs a build. */
function engineJarState() {
  const jar = path.join(ROOT, ENGINE_JAR)
  const mtime = existsSync(jar) ? statSync(jar).mtimeMs : undefined
  return { jar, mtime, stale: jarIsStale(mtime, Math.max(...ENGINE_JAR_SOURCES.map(newestMtime))) }
}

/** Build the engine jar the image copies when it is missing or older than its sources. */
async function ensureEngineJar(forceContainer) {
  const { jar, stale } = engineJarState()
  if (!stale) return
  const gradle = await gradleRun(
    { project: "playground/cibseven-example", tasks: ["bootJar"] },
    forceContainer,
  )
  say(`Building the engine jar on the ${describeJdk(gradle.jdk)} (first time: a few minutes) ...`)
  await must(gradle.argv, "The engine jar build", { cwd: gradle.cwd, env: gradle.env })
  // Gradle leaves an up-to-date jar untouched; mark it as built from the current sources.
  const now = new Date()
  utimesSync(jar, now, now)
}

const health = (services) => Promise.all(services.map((service) => answers(service.probe)))

/** Start the stack unless it already answers; never a second stack on the same ports. */
async function ensureStack(options) {
  await ensureDocker()
  const services = servicesFor(options)
  const awaited = services.filter((service) => service.waitFor !== false)
  if ((await health(awaited)).every(Boolean)) {
    const owner = (await dockerPs()).get(awaited[0].ports[0])
    const where = owner?.project ? ` (Compose project ${owner.project})` : ""
    say(`The playground already runs${where}; reusing it.`)
    const jar = engineJarState()
    if (jar.stale) say(staleJarNote(jar.mtime))
    return services
  }
  const owners = await dockerPs()
  for (const port of services.flatMap((service) => service.ports)) {
    if (!(await portBound(port))) continue
    const conflict = portConflict(port, owners.get(port))
    if (conflict) throw new Failure(`Cannot start the playground: ${conflict}.`)
  }
  await ensureEngineJar(options.jdkContainer)
  say("Starting the playground ...")
  await must(compose(profilesFor(options), "up", "-d", "--build"), "docker compose up")
  for (const service of awaited) {
    say(`Waiting for ${service.id} (${service.probe}) ...`)
    await waitFor(service.id, () => answers(service.probe), STACK_TIMEOUT_MS)
  }
  return services
}

const serviceLine = (service) =>
  `  ${service.id.padEnd(15)} ${service.url}${service.note ? `  (${service.note})` : ""}`

async function stackUp(options) {
  const services = await ensureStack(options)
  console.log(`\nPlayground ready:\n${services.map(serviceLine).join("\n")}`)
  console.log(
    "\nNext: pnpm play (MCP server and inspector), pnpm play:cli -- ping, pnpm stack:status",
  )
}

async function stackDown({ wipe }) {
  await ensureDocker()
  // Every profile and the project's containers the file no longer defines, so nothing of the
  // project keeps running; volumes stay unless --wipe.
  const profiles = ["multi-engine", "auth", "full", "dev"]
  await must(
    compose(profiles, "down", "--remove-orphans", ...(wipe ? ["--volumes"] : [])),
    "docker compose down",
  )
  console.log(wipe ? "Playground stopped, volumes removed." : "Playground stopped (volumes kept).")
}

async function stackStatus() {
  if (!(await dockerRunning())) {
    console.log(
      "Docker is not running, so neither is the playground. Start Docker, then pnpm stack:up.",
    )
    return
  }
  const owners = await dockerPs()
  const server = {
    id: "mcp-server",
    ports: [8400],
    url: "http://localhost:8400/mcp",
    start: "pnpm play",
  }
  const rows = await Promise.all(
    [...SERVICES, server].map(async (service) => {
      const owner = owners.get(service.ports[0])
      const up = service === server ? await portBound(DEFAULT_PORT) : await answers(service.probe)
      const start =
        service.start ?? `pnpm stack:up${service.profile ? ` --${service.profile}` : ""}`
      const state = up ? "up" : owner ? "starting or unhealthy" : `not running (${start})`
      const where = owner ? `  ${owner.container}${owner.project ? ` [${owner.project}]` : ""}` : ""
      return `  ${service.id.padEnd(15)} ${service.url.padEnd(29)} ${state}${up ? where : ""}`
    }),
  )
  console.log(`Playground (Compose project ${COMPOSE_PROJECT}):\n${rows.join("\n")}`)
  console.log("\nStop: pnpm stack:down (the server: Ctrl-C where pnpm play runs)")
}

// ── play and play:cli ───────────────────────────────────────────────────────

const install = () =>
  must(pnpmArgv(["install", "--frozen-lockfile"]), "pnpm install --frozen-lockfile")

/** turbo builds `filters` (generate runs first: build depends on it). */
const turboBuild = (...filters) =>
  must(
    pnpmArgv([
      "exec",
      "turbo",
      "run",
      "build",
      ...filters.map((filter) => `--filter=${filter}`),
      "--output-logs=errors-only",
    ]),
    `The build (${filters.join(", ")})`,
  )

/**
 * Signal every process of a tree started detached: its process group on POSIX (it outlives
 * the group leader), the tree under the pid on Windows (taskkill /T).
 */
function signalTree(child, signal) {
  if (process.platform === "win32") {
    if (child.exitCode === null)
      execFile("taskkill", ["/pid", String(child.pid), "/T", "/F"], () => {})
    return
  }
  try {
    process.kill(-child.pid, signal)
  } catch {
    // The group is gone already.
  }
}

/**
 * Fail before the install and the build when the server's port is taken. The message names the
 * port only when it is the default: a value from the caller's environment is never logged.
 */
async function ensurePortFree(port, fromEnv) {
  if (await portBound(port)) {
    const which = fromEnv ? "The port your PORT names" : `Port ${DEFAULT_PORT}`
    throw new Failure(
      `${which} is taken (another pnpm play or pnpm dev?). Stop it, or set PORT to another port.`,
    )
  }
}

/** Name what the caller's environment changes in a preset. */
function sayOverrides({ overridden, outranking }) {
  for (const name of overridden) {
    say(`${name} comes from your environment, not the playground preset.`)
  }
  for (const name of outranking) {
    say(`${name} comes from your environment and replaces the playground engines.`)
  }
}

async function play(options) {
  const preset = serverPreset(options)
  const { env, ...overrides } = withPreset(preset, process.env)
  const portFromEnv = process.env.PORT !== undefined
  const port = Number(env.PORT ?? DEFAULT_PORT)
  await ensureDocker()
  await ensurePortFree(port, portFromEnv)
  await install()
  await ensureStack(options)
  say("Building the server's packages ...")
  await turboBuild(`${SERVER_PACKAGE}^...`)
  await ensurePortFree(port, portFromEnv)
  sayOverrides(overrides)
  // Named from the preset, never echoed from the caller's environment (sayOverrides names it).
  const toolsets =
    process.env.MCP_ACTIVE_MODULES !== undefined
      ? "from your MCP_ACTIVE_MODULES"
      : (preset.MCP_ACTIVE_MODULES ??
        (options.auth ? "the default under OAuth" : "the read-only default"))
  say(`Starting the MCP server (toolsets: ${toolsets}) ...`)
  const [command, ...args] = pnpmArgv(["--fail-if-no-match", "--filter", SERVER_PACKAGE, "dev"])
  const child = spawn(command, args, {
    cwd: ROOT,
    env,
    stdio: ["ignore", "inherit", "inherit"],
    // Its own process group on POSIX, so stopping it reaches every process under pnpm.
    detached: process.platform !== "win32",
  })
  let stopping = false
  const stop = (signal) => {
    if (stopping) return signalTree(child, "SIGKILL")
    stopping = true
    say(`\nStopping the MCP server (${signal}); the playground keeps running (pnpm stack:down).`)
    signalTree(child, "SIGTERM")
    setTimeout(() => signalTree(child, "SIGKILL"), 10_000).unref()
  }
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, () => stop(signal))
  // A signal the server did not get from us (an OOM kill, say) is a failure.
  const exited = new Promise((resolve) => child.on("exit", (code) => resolve(code ?? 1)))
  const base = `http://localhost:${port}`
  const inspector = `http://127.0.0.1:${port}${INSPECTOR}`
  const gone = () => child.exitCode !== null || child.signalCode !== null
  let ready = false
  try {
    await waitFor(
      "The MCP server",
      async () => gone() || (ready = await answers(inspector)),
      SERVER_TIMEOUT_MS,
    )
  } catch (error) {
    signalTree(child, "SIGKILL")
    throw error
  }
  if (ready) {
    console.log(
      `\nMCP server ready:\n  MCP endpoint  ${base}/mcp\n  inspector     ${base}${INSPECTOR}\n` +
        "Ctrl-C stops the server; the playground keeps running.",
    )
  }
  const code = await exited
  // pnpm is gone; nothing it started may outlive it.
  signalTree(child, "SIGKILL")
  if (stopping) {
    process.exitCode = 0
  } else if (!ready) {
    say(`\nThe MCP server exited (exit ${code}) before it answered; its output is above.`)
    process.exitCode = code || 1
  } else {
    process.exitCode = code
  }
}

async function playCli(_options, rest) {
  await ensureDocker()
  await install()
  await ensureStack({})
  await turboBuild(`${CLI_PACKAGE}...`)
  const { env, ...overrides } = withPreset(cliPreset(), process.env)
  sayOverrides(overrides)
  process.exitCode = await run([process.execPath, path.join(ROOT, CLI_ENTRY), ...rest], { env })
}

// ── test:one ────────────────────────────────────────────────────────────────

async function testOne({ watch }, files) {
  const plan = testOnePlan({
    files,
    watch,
    root: ROOT,
    // A root script runs at the root; `pnpm -w test:one` in a package keeps its relative paths.
    cwd: process.env.INIT_CWD ?? ROOT,
    workspace: readWorkspace(ROOT),
    realpath: realpathOnDisk,
  })
  if (plan instanceof Error) throw new Failure(plan.message)
  if (plan.builds.length > 0) await turboBuild(...plan.builds)
  if (watch) say("Watching this package; after a change in a package below it, run this again.")
  const failed = []
  for (const { dir, name, args, hint } of plan.runs) {
    if ((await run(pnpmArgv(args), { cwd: path.join(ROOT, dir) })) === 0) continue
    failed.push(name)
    if (hint !== undefined) say(`\n${hint}`)
  }
  if (failed.length > 0) throw new Failure(`test:one failed in ${failed.join(", ")}.`)
}

// ── check and check:all ─────────────────────────────────────────────────────

async function check(options, all) {
  const logDir = path.join(ROOT, CHECK_LOG_DIR)
  rmSync(logDir, { recursive: true, force: true })
  mkdirSync(logDir, { recursive: true })
  let current
  let interrupted = false
  process.on("SIGINT", () => {
    interrupted = true
    current?.kill("SIGINT")
  })
  const results = []
  const started = Date.now()
  for (const [index, step] of checkSteps({ all, force: options.force }).entries()) {
    if (interrupted) break
    const log = path.join(CHECK_LOG_DIR, logName(index, step.name))
    const fd = openSync(path.join(ROOT, log), "w")
    const begin = Date.now()
    say(`${step.name} ...`)
    let code
    try {
      const target = step.gradle
        ? await gradleRun(step.gradle, options.jdkContainer)
        : { argv: argvOf(step), cwd: ROOT, env: process.env }
      code = await new Promise((resolve) => {
        current = spawn(target.argv[0], target.argv.slice(1), {
          cwd: target.cwd,
          env: target.env,
          stdio: ["ignore", fd, fd],
        })
        current.on("error", (error) => {
          // The log says why the step did not start (a missing bash or git, say).
          writeSync(fd, `Could not start ${target.argv[0]}: ${error.message}\n`)
          resolve(127)
        })
        current.on("exit", (exit) => resolve(exit ?? 1))
      })
    } catch (error) {
      code = 1
      say(error.message)
    } finally {
      closeSync(fd)
    }
    const result = { name: step.name, outcome: outcomeOf(step, code), ms: Date.now() - begin, log }
    results.push(result)
    console.log(stepLine(result))
  }
  const { text, failed } = checkSummary(results, { interrupted })
  console.log(`\n${text} (${formatDuration(Date.now() - started)})`)
  process.exitCode = failed ? 1 : 0
}

// ── main ────────────────────────────────────────────────────────────────────

const COMMAND_RUNNERS = {
  "stack:up": stackUp,
  "stack:down": stackDown,
  "stack:status": stackStatus,
  play,
  "play:cli": playCli,
  "test:one": testOne,
  check: (options) => check(options, false),
  "check:all": (options) => check(options, true),
}

const parsed = parseArgs(process.argv.slice(2))
if (parsed instanceof Error) {
  console.error(`${parsed.message}\n\n${USAGE}`)
  process.exit(2)
}
try {
  await COMMAND_RUNNERS[parsed.command](parsed.options, parsed.rest)
} catch (error) {
  if (!(error instanceof Failure)) throw error
  console.error(`\n${error.message}`)
  process.exitCode = 1
}
