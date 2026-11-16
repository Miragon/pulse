import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest"
import { oauthKeycloakProvider } from "../oauth-providers.js"
import { startFakeOidc, type FakeOidc } from "../testing/oidc/index.js"
import { bootWeb, Browser, RESOURCE, SESSION_KEYS, signIn, webEnv } from "./sign-in.test-support.js"

let fake: FakeOidc
let info: MockInstance<(...data: unknown[]) => void>

beforeEach(async () => {
  fake = await startFakeOidc({ audience: RESOURCE })
  info = vi.spyOn(console, "info").mockImplementation(() => {})
  vi.spyOn(console, "log").mockImplementation(() => {})
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

afterEach(async () => {
  vi.restoreAllMocks()
  await fake.close()
})

const refusalOf = async (env: NodeJS.ProcessEnv, overrides = {}) => {
  try {
    await bootWeb(env, overrides)
  } catch (error) {
    return (error as Error).message
  }
  throw new Error("expected the boot to fail")
}

describe("the boot and the web app", () => {
  it("names the web app in its log, without the secret or a key", async () => {
    await bootWeb(webEnv(fake))
    const lines = info.mock.calls.map(([line]) => String(line))
    expect(lines).toContain(
      "[web-test] Web app: on at http://localhost/app for client pulse-web; sessions last 8 h; 1 session key.",
    )
    expect(lines.join("\n")).not.toContain(SESSION_KEYS)
    expect(lines.join("\n")).not.toContain("pulse-web-secret")
  })

  it("installs no /app without an OAuth provider: MCP_WEB_CLIENT_ID alone fails the boot", async () => {
    const env = {
      MCP_URL: "http://localhost",
      MCP_WEB_CLIENT_ID: "pulse-web",
      MCP_WEB_CLIENT_SECRET: "s",
      MCP_WEB_SESSION_KEYS: SESSION_KEYS,
    }
    expect(await refusalOf(env)).toContain(
      "MCP_WEB_CLIENT_ID is set, but no OAuth provider is: the web app signs people in through the server's provider.",
    )
  })

  it("needs MCP_URL, also beside a provider that names its own resource", async () => {
    const env = webEnv(fake)
    delete env.MCP_URL
    const provider = {
      ...oauthKeycloakProvider({ serverUrl: fake.serverUrl, realm: fake.realm }),
      resource: RESOURCE,
    }
    expect(await refusalOf(env, { oauth: provider })).toContain("The web app needs MCP_URL")
  })

  it("refuses an MCP_URL over plain http off the machine itself", async () => {
    const env = webEnv(fake, { MCP_URL: "http://pulse.example.test" })
    expect(await refusalOf(env)).toContain("does not use HTTPS")
  })

  it("counts the web app's requests under route=/app", async () => {
    const app = await bootWeb(webEnv(fake))
    const browser = new Browser(app)
    await signIn(browser, fake)
    const metrics = await (await browser.fetch("/metrics")).text()
    expect(metrics).toContain('mcp_http_requests_total{method="GET",route="/app",status="302"} 1')
    expect(metrics).toContain('mcp_http_requests_total{method="GET",route="/app",status="303"} 1')
  })
})
