import { execFileSync } from "node:child_process"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { basicLogin, clusterClient } from "../support/cluster-client.mjs"
import { removeContainer, startContainer, waitUntil } from "../support/containers.mjs"
import { endpointOf, operateOf, SANDBOX_CLUSTERS, SHOP_DEV } from "./clusters.mjs"
import { ownCluster } from "./own-cluster.mjs"
import { activeIncidentCount, holdsTheShop, seedCluster, shopCount } from "./seed.mjs"
import { runTraffic } from "./traffic.mjs"

const STARTUP_MS = 240_000

function clientOf(cluster) {
  const login =
    cluster.seedCredentials === undefined ? undefined : basicLogin(cluster.seedCredentials)
  return clusterClient(endpointOf(cluster), login)
}

async function countsOf(client) {
  const instances = (state) => shopCount(client, "/process-instances/search", { state })
  const [running, completed, terminated, incidents] = await Promise.all([
    instances("ACTIVE"),
    instances("COMPLETED"),
    instances("TERMINATED"),
    activeIncidentCount(client),
  ])
  return `running ${running} · ended ${completed + terminated} · open incidents ${incidents}`
}

async function describe(cluster) {
  const client = clientOf(cluster)
  return [
    `${cluster.name}  ${client.endpoint}  (${cluster.login})`,
    `  ${await countsOf(client)}`,
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

async function seed() {
  const client = ownCluster(process.env)
  await client.isReady()
  if (await holdsTheShop(client)) {
    throw new Error(
      `${client.endpoint} already holds a process of the shop (order-fulfillment, shipment or return-handling). Seed a cluster without them.`,
    )
  }
  console.log(`Seeding the shop into ${client.endpoint} ...`)
  await seedCluster(client, { ...SHOP_DEV, name: client.endpoint })
  console.log(`\nThe shop is in your cluster: ${await countsOf(client)}.`)
  console.log(
    "Add it in VS Code with Pulse: Add Engine…, then follow apps/vscode/sandbox-c8/README.md.",
  )
}

const COMMANDS = {
  up,
  open,
  traffic,
  seed,
  down: () => {
    SANDBOX_CLUSTERS.forEach((cluster) => removeContainer(cluster.container.name))
  },
}

const command = COMMANDS[process.argv[2]]
if (command === undefined) {
  console.error("Usage: node scripts/sandbox-c8/sandbox.mjs up|open|traffic|seed|down")
  process.exit(1)
}
await command()
