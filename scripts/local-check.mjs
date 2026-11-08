/**
 * The steps of `pnpm check` and `pnpm check:all` and their summary (pure but for reading the root
 * `lint` and `test` chains; scripts/local-check.test.mjs). A step is `{ name, command, args }`, or
 * `{ name, gradle }` for a Gradle build scripts/local.mjs places on a JDK; `bestEffort` steps warn
 * instead of failing.
 */
import { readFileSync } from "node:fs"

/** Where the step logs go (gitignored: reports/). */
export const CHECK_LOG_DIR = "reports/check"

const pnpm = (name, ...args) => ({ name, command: "pnpm", args })

const rootScripts = () =>
  JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).scripts

/** The tasks of the one turbo step: a chain's `turbo run` of these already ran in it. */
const TURBO_TASKS = ["build", "typecheck", "test", "lint"]

/** The gate the ratchet lets a chain grow by (check-ratchets.mjs). */
const PNPM_SEGMENT = /^pnpm (?:run )?([\w:-]+)$/
/** The chains' turbo segments: tasks, then flags (`--continue=dependencies-successful`). */
const TURBO_SEGMENT = /^turbo run ([\w:-]+(?: [\w:-]+)*)(?: --[\w-]+(?:=[\w,.-]+)?)*$/

/**
 * One step per segment of a root chain (`lint`, `test`), each with its own log: an `&&` would
 * hide every gate behind a red one, and a gate added to the chain joins here by itself. A
 * `turbo run` of the turbo step's tasks is left to that step, which runs it past a red package.
 * The ratchet lets a chain grow only by plain `pnpm <script>` gates, so each step runs without a
 * shell; any other segment fails here instead of running as something else.
 */
export function chainSteps(script, chain) {
  return script.split("&&").flatMap((raw) => {
    const segment = raw.trim().replace(/\s+/g, " ")
    const gate = PNPM_SEGMENT.exec(segment)?.[1]
    if (gate) return [pnpm(gate, gate)]
    const tasks = TURBO_SEGMENT.exec(segment)?.[1].split(" ")
    if (tasks?.every((task) => TURBO_TASKS.includes(task))) return []
    if (tasks) return [pnpm(`${chain}:turbo`, "exec", ...segment.split(" "))]
    throw new Error(
      `pnpm check runs each gate of the ${chain} chain without a shell and cannot run "${segment}": make it a root script and chain \`pnpm <script>\``,
    )
  })
}

/** The standard local bar, then with `all` the checks CI runs in their own jobs. */
export function checkSteps({ all = false, force = false, scripts = rootScripts() } = {}) {
  const steps = [
    pnpm("install", "install", "--frozen-lockfile"),
    // The VS Code webview tests in `test` render in Chromium.
    pnpm(
      "browsers",
      "--fail-if-no-match",
      "--filter",
      "pulse-cockpit",
      "exec",
      "playwright",
      "install",
      "chromium",
    ),
    pnpm(
      "turbo",
      "exec",
      "turbo",
      "run",
      ...TURBO_TASKS,
      // A red package does not cancel its siblings; only what depends on it stays out.
      "--continue=dependencies-successful",
      ...(force ? ["--force"] : []),
    ),
    ...chainSteps(scripts.test, "test"),
    // lint:ratchets compares against origin/main; offline it still runs on the last fetch.
    { name: "fetch", command: "git", args: ["fetch", "origin"], bestEffort: true },
    ...chainSteps(scripts.lint, "lint"),
    pnpm("format:check", "format:check"),
  ]
  if (!all) return steps
  const server = ["--fail-if-no-match", "--filter", "@miragon/pulse-mcp-server"]
  return [
    ...steps,
    pnpm("host browsers", ...server, "exec", "playwright", "install", "chromium"),
    pnpm("test:host", ...server, "test:host"),
    { name: "template", command: "bash", args: ["scripts/test-template.sh"] },
    {
      name: "cibseven-example",
      gradle: { project: "playground/cibseven-example", tasks: ["build"] },
    },
    pnpm("docs:build", "docs:build"),
    pnpm("test:engines", "--fail-if-no-match", "--filter", "@miragon/pulse-cli", "test:engines"),
  ]
}

/** `03-test-scripts.log` for the third step `test:scripts`. */
export const logName = (index, name) =>
  `${String(index + 1).padStart(2, "0")}-${name.replace(/[^\w-]+/g, "-")}.log`

/** `4s`, `2m 05s`. */
export function formatDuration(ms) {
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`
}

/** A step's outcome from its exit code: `ok`, `warn` (best effort) or `FAILED`. */
export const outcomeOf = (step, exitCode) =>
  exitCode === 0 ? "ok" : step.bestEffort ? "warn" : "FAILED"

/** One summary line: outcome, step, duration, log. */
export const stepLine = ({ outcome, name, ms, log }) =>
  `${outcome.padEnd(6)} ${name.padEnd(24)} ${formatDuration(ms).padStart(7)}  ${log}`

/** The closing lines and whether the run failed: every step ran, any FAILED fails it. */
export function checkSummary(results, { interrupted = false } = {}) {
  const failed = results.filter(({ outcome }) => outcome === "FAILED")
  const warned = results.filter(({ outcome }) => outcome === "warn")
  const lines = [
    interrupted
      ? `Interrupted after ${results.length} step(s).`
      : failed.length > 0
        ? `${failed.length} of ${results.length} steps failed: ${failed.map(({ name }) => name).join(", ")}.`
        : warned.length > 0
          ? `${results.length - warned.length} of ${results.length} steps passed, ${warned.length} did not (best effort).`
          : `All ${results.length} steps passed.`,
    ...failed.map(({ name, log }) => `  ${name}: see ${log}`),
    ...warned.map(({ name, log }) => `  ${name} did not succeed (best effort): see ${log}`),
  ]
  return { text: lines.join("\n"), failed: interrupted || failed.length > 0 }
}
