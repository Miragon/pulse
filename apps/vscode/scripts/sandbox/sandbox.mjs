import { execFileSync } from "node:child_process"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { removeContainer, startContainer, waitUntil } from "../support/containers.mjs"
import { engineClient } from "../support/engine-client.mjs"
import { endpointOf, SANDBOX_ENGINES, SHOP_DEV } from "./engines.mjs"
import { rootIncidentCount, seedEngine } from "./seed.mjs"
import { runTraffic } from "./traffic.mjs"

function clientOf(engine) {
  return engineClient(endpointOf(engine), engine.credentials)
}

async function describe(engine) {
  const client = clientOf(engine)
  const [running, ended, incidents] = await Promise.all([
    client.get("/process-instance/count"),
    client.get("/history/process-instance/count?finished=true"),
    rootIncidentCount(client),
  ])
  const login = engine.credentials === undefined ? "no login" : "login demo / demo"
  return [
    `${engine.name}  ${client.endpoint}  (${login})`,
    `  running ${running.count} · ended ${ended.count} · open incidents ${incidents}`,
    `  web app for comparison: ${engine.webApp}`,
  ].join("\n")
}

async function startAndSeed(engine) {
  startContainer(engine.container)
  const client = clientOf(engine)
  await waitUntil(client.isReady, `${engine.name} to start`, 240_000)
  await seedEngine(client, engine)
}

async function up() {
  console.log("Starting shop-dev (Operaton) and shop-test (CIB seven) ...")
  await Promise.all(SANDBOX_ENGINES.map(startAndSeed))
  const descriptions = await Promise.all(SANDBOX_ENGINES.map(describe))
  console.log(`\nSandbox ready.\n\n${descriptions.join("\n\n")}\n`)
  console.log('Try it: npm run sandbox:open, or press F5 on "Run Pulse (sandbox)".')
  console.log("Live traffic: npm run sandbox:traffic")
}

async function traffic() {
  if (!(await isRunning(SHOP_DEV))) {
    throw new Error(`${SHOP_DEV.name} is not running. Start it with: npm run sandbox:up`)
  }
  await runTraffic(clientOf(SHOP_DEV))
}

async function isRunning(engine) {
  return clientOf(engine)
    .isReady()
    .catch(() => false)
}

async function open() {
  if (!(await isRunning(SHOP_DEV))) {
    await up()
  }
  const extension = fileURLToPath(new URL("../../", import.meta.url))
  const sandbox = fileURLToPath(new URL("../../sandbox", import.meta.url))
  const profile = join(tmpdir(), "pulse-sandbox")
  execFileSync(
    "code",
    [`--user-data-dir=${profile}`, `--extensionDevelopmentPath=${extension}`, sandbox],
    { stdio: "inherit" },
  )
  console.log("Opened the sandbox in its own VS Code instance with this build of Pulse.")
}

const COMMANDS = {
  up,
  open,
  traffic,
  down: () => {
    SANDBOX_ENGINES.forEach((engine) => removeContainer(engine.container.name))
  },
}

const command = COMMANDS[process.argv[2]]
if (command === undefined) {
  console.error("Usage: node scripts/sandbox/sandbox.mjs up|open|traffic|down")
  process.exit(1)
}
await command()
