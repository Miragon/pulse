import { createRequire } from "node:module"

const SERVER = new URL("../../apps/mcp-server/", import.meta.url)
const SHOP_DEV = "http://localhost:18090/engine-rest"
const ORDER = "ORD-10131"
const FAILED_ACTIVITY = "Activity_ChargePayment"
const ENGINES = {
  profiles: {
    "shop-dev": {
      url: SHOP_DEV,
      flavor: "operaton",
      cockpitUrl: "http://localhost:18090/operaton/app/cockpit/default",
    },
  },
}

async function shopDev(path) {
  const response = await fetch(`${SHOP_DEV}${path}`).catch(() => undefined)
  if (response?.ok !== true) {
    throw new Error(
      "The sandbox is not running. Start it with: pnpm --filter pulse-cockpit run sandbox:up",
    )
  }
  return response.json()
}

async function chargePaymentIncident() {
  const [instance] = await shopDev(`/process-instance?businessKey=${ORDER}`)
  const [incident] = await shopDev(
    `/incident?processInstanceId=${instance?.id}&activityId=${FAILED_ACTIVITY}`,
  )
  if (incident === undefined) {
    throw new Error(`${ORDER} has no incident at ${FAILED_ACTIVITY}: start a fresh sandbox`)
  }
  return incident.id
}

async function startHost() {
  const fromServer = createRequire(new URL("package.json", SERVER))
  const { Client, StreamableHTTPClientTransport } = fromServer("@modelcontextprotocol/client")
  const { createApp } = await import(new URL("dist/app.js", SERVER).href)
  const { startHostBackend } = await import(new URL("test-host/host-backend.ts", SERVER).href)
  const composed = await createApp({
    ENGINES_JSON: JSON.stringify(ENGINES),
    MCP_ACTIVE_MODULES: "engine:operations",
  })
  const running = await composed.listen({ port: 0, host: "127.0.0.1", drainTimeoutMs: 1000 })
  const client = new Client({ name: "product-shots", version: "1.0.0" })
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${running.port}/mcp`)),
  )
  const host = await startHostBackend(client)
  return {
    url: host.url,
    close: async () => {
      await host.close()
      await client.close()
      await running.shutdown()
    },
  }
}

function scenario(incidentId, { viewport, theme }) {
  return new URLSearchParams({
    tool: "engine_open_cockpit",
    args: JSON.stringify({ engine: "shop-dev", view: "incident-detail", incidentId }),
    structuredContent: "keep",
    theme,
    width: String(viewport.width),
    displayModes: "inline",
  })
}

export async function open({ browser, settings }) {
  const incidentId = await chargePaymentIncident()
  const host = await startHost()
  const context = await browser.newContext({
    viewport: settings.viewport,
    deviceScaleFactor: settings.scale,
    colorScheme: settings.theme,
  })
  const page = await context.newPage()
  await page.goto(`${host.url}/?${scenario(incidentId, settings)}`)
  return {
    page,
    close: async () => {
      await context.close()
      await host.close()
    },
  }
}

export default async function showIncident(page) {
  await page.addStyleTag({ content: "html, body { overflow: hidden }" })
  const view = page.frameLocator("#app")
  await view.getByRole("img").first().waitFor({ timeout: 30_000 })
  await view.locator("body").evaluate(() => globalThis.document.fonts.ready)
  await page.waitForTimeout(2500)
}
