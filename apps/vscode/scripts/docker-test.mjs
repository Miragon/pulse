import { execFileSync, spawnSync } from "node:child_process"
import { mkdirSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { containerTool } from "./support/containers.mjs"

const SUITES = ["smoke", "e2e"]
const IMAGE = "pulse-vscode-tests"
const ENGINE = "pulse-dev-engine"
const ROOT = resolve("../..")
const RESULTS = resolve("test-results")

function fail(message) {
  console.error(message)
  process.exit(2)
}

function run(tool, args) {
  const result = spawnSync(tool, args, { stdio: "inherit" })
  if (result.error !== undefined) {
    throw result.error
  }
  return result.status ?? 1
}

function engineRuns(tool) {
  try {
    const state = execFileSync(tool, ["inspect", "-f", "{{.State.Running}}", ENGINE], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
    return state.trim() === "true"
  } catch {
    return false
  }
}

function pnpmVersion() {
  const manifest = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8"))
  return manifest.packageManager.split("@")[1]
}

const suite = process.argv[2]
if (!SUITES.includes(suite)) {
  fail(`Usage: node scripts/docker-test.mjs ${SUITES.join("|")}`)
}
const tool = containerTool()
if (suite === "e2e" && !engineRuns(tool)) {
  fail(`No running ${ENGINE}. Run "pnpm --filter pulse-cockpit run engine:up" first.`)
}
const built = run(tool, [
  "build",
  "-q",
  "-t",
  IMAGE,
  "--build-arg",
  `PNPM_VERSION=${pnpmVersion()}`,
  resolve("test/docker"),
])
if (built !== 0) {
  process.exit(built)
}
mkdirSync(RESULTS, { recursive: true })
const network = suite === "e2e" ? ["--network", `container:${ENGINE}`] : []
process.exit(
  run(tool, [
    "run",
    "--rm",
    "--init",
    "--shm-size=1g",
    ...network,
    "-v",
    `${ROOT}:/src:ro`,
    "-v",
    "pulse-vscode-tests-work:/work",
    "-v",
    "pulse-vscode-tests-store:/pnpm-store",
    "-v",
    `${RESULTS}:/results`,
    "-e",
    "PULSE_E2E_SHOTS=/results/e2e",
    "-e",
    "PULSE_VSCODE_NO_SANDBOX=1",
    IMAGE,
    "bash",
    "/src/apps/vscode/test/docker/run-suite.sh",
    suite,
  ]),
)
