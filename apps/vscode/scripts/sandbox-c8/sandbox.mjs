import { execFileSync } from "node:child_process"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { clusterClient } from "../support/cluster-client.mjs"
import { removeContainer, startContainer, waitUntil } from "../support/containers.mjs"
import { endpointOf, operateOf, SANDBOX_CLUSTERS, SHOP_DEV } from "./clusters.mjs"
import { activeIncidentCount, seedCluster } from "./seed.mjs"
import { runTraffic } from "./traffic.mjs"

const STARTUP_MS = 240_000

function clientOf(cluster) {
  return clusterClient(endpointOf(cluster), cluster.seedCredentials)
}

async function describe(cluster) {
  const client = clientOf(cluster)
  const instances = (state) => client.count("/process-instances/search", { state })
  const [running, completed, terminated, incidents] = await Promise.all([
    instances("ACTIVE"),
    instances("COMPLETED"),
    instances("TERMINATED"),
    activeIncidentCount(client),
  ])
  return [
    `${cluster.name}  ${client.endpoint}  (${cluster.login})`,
    `  running ${running} · ended ${completed + terminated} · open incidents ${incidents}`,
    `  Operate for comparison: ${operateOf(cluster)} (demo / demo)`,
  ].join("\n")
}

async function startAndSeed(cluster) {
  startContainer(cluster.container)
  const client = clientOf(cluster)
  await waitUntil(client.isReady, `${cluster.name} to start`, STARTUP_MS)
  await seedCluster(client, cluster)
}

async function up() {
  console.log(`Starting shop-dev and shop-test (${SHOP_DEV.container.image}) ...`)
  await Promise.all(SANDBOX_CLUSTERS.map(startAndSeed))
  const descriptions = await Promise.all(SANDBOX_CLUSTERS.map(describe))
  console.log(`\nSandbox ready.\n\n${descriptions.join("\n\n")}\n`)
  console.log(
    'Try it: pnpm --filter pulse-cockpit run sandbox:c8:open, or press F5 on "Run Pulse (sandbox, Camunda 8)".',
  )
  console.log("Live traffic: pnpm --filter pulse-cockpit run sandbox:c8:traffic")
}

function isRunning(cluster) {
  return clientOf(cluster)
    .isReady()
    .catch(() => false)
}

async function traffic() {
  if (!(await isRunning(SHOP_DEV))) {
    throw new Error(
      `${SHOP_DEV.name} is not running. Start it with: pnpm --filter pulse-cockpit run sandbox:c8:up`,
    )
  }
  await runTraffic(clientOf(SHOP_DEV))
}

async function open() {
  if (!(await isRunning(SHOP_DEV))) {
    await up()
  }
  const extension = fileURLToPath(new URL("../../", import.meta.url))
  const sandbox = fileURLToPath(new URL("../../sandbox-c8", import.meta.url))
  const profile = join(tmpdir(), "pulse-sandbox-c8")
  execFileSync(
    "code",
    [`--user-data-dir=${profile}`, `--extensionDevelopmentPath=${extension}`, sandbox],
    { stdio: "inherit" },
  )
  console.log("Opened the Camunda 8 sandbox in its own VS Code instance with this build of Pulse.")
}

const COMMANDS = {
  up,
  open,
  traffic,
  down: () => {
    SANDBOX_CLUSTERS.forEach((cluster) => removeContainer(cluster.container.name))
  },
}

const command = COMMANDS[process.argv[2]]
if (command === undefined) {
  console.error("Usage: node scripts/sandbox-c8/sandbox.mjs up|open|traffic|down")
  process.exit(1)
}
await command()
