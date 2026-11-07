import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ComposableModule } from "./composition.js"
import {
  createComposedServer,
  retiredEnvVars,
  type ComposedServerOptions,
} from "./composed-server.js"
import { OAUTH_ENV_VARS } from "./oauth-env.js"
import { RENAMED_BOOT_ENV_VARS } from "./retired-boot-env.js"

/** The boot's own settings: the names it read up to 0.27, those with no effect, the log level. */

const createPlugin = vi.fn(() => ({ name: "alpha", register: () => {} }))

const alpha: ComposableModule<object> = {
  name: "alpha",
  configFromEnv: () => ({}),
  knownEnvVars: [],
  createPlugin,
}

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {})
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  createPlugin.mockClear()
})

const options = (env: NodeJS.ProcessEnv): ComposedServerOptions => ({
  info: { name: "test-root", version: "0.0.0" },
  modules: [alpha],
  bundle: { jsPath: "/nonexistent/mcp-app.js" },
  env,
})

const warnings = () => vi.mocked(console.warn).mock.calls.map(([line]) => String(line))

describe("createComposedServer: the boot's former settings", () => {
  it("lists its own renamed variables among the retired ones a neutral env clears", () => {
    expect([...retiredEnvVars([alpha])]).toEqual(Object.keys(RENAMED_BOOT_ENV_VARS))
  })

  // Each name the boot read up to 0.27 is refused, naming its successor.
  it("refuses every name it read up to 0.27, naming the one that replaces it", async () => {
    expect(RENAMED_BOOT_ENV_VARS).toEqual({
      ...Object.fromEntries(
        OAUTH_ENV_VARS.map((name) => [name.replace(/^MCP_/, "MCP_USE_"), name]),
      ),
      MCP_USE_OAUTH_DEBUG: "MCP_OAUTH_DEBUG",
      MCP_USE_LOG_LEVEL: "MCP_LOG_LEVEL",
    })
    await expect(
      createComposedServer(
        options({
          MCP_USE_OAUTH_KEYCLOAK_SERVER_URL: "https://kc.example.com",
          MCP_USE_OAUTH_KEYCLOAK_REALM: "platform",
          MCP_USE_LOG_LEVEL: "",
        }),
      ),
    ).rejects.toThrow(
      "[test-root] MCP_USE_LOG_LEVEL, MCP_USE_OAUTH_KEYCLOAK_REALM, MCP_USE_OAUTH_KEYCLOAK_SERVER_URL are no longer read, so the server does not start with settings it would ignore. " +
        "Rename them, the values stay: MCP_USE_LOG_LEVEL becomes MCP_LOG_LEVEL, MCP_USE_OAUTH_KEYCLOAK_REALM becomes MCP_OAUTH_KEYCLOAK_REALM, MCP_USE_OAUTH_KEYCLOAK_SERVER_URL becomes MCP_OAUTH_KEYCLOAK_SERVER_URL.",
    )
    expect(createPlugin).not.toHaveBeenCalled()
    expect(warnings()).toEqual([])
  })

  // Read up to 0.27 only: the boot says they change nothing, without a typo warning on top.
  it("warns that the former CSP, asset and telemetry variables have no effect", async () => {
    await createComposedServer(
      options({
        CSP_URLS: "https://a.example",
        CSP_CONNECT_DOMAINS: "https://b.example",
        CSP_RESOURCE_DOMAINS: "",
        MCP_ASSETS_URL: "https://cdn.example",
        MCP_USE_ANONYMIZED_TELEMETRY: "false",
        CSP_POLICY: "unrelated",
      }),
    )
    expect(
      warnings().filter((line) => /no effect|Unknown environment variable/.test(line)),
    ).toEqual([
      "[test-root] CSP_CONNECT_DOMAINS, CSP_RESOURCE_DOMAINS, CSP_URLS have no effect: a view's CSP holds the server's own origin, the served fonts' and what its tool declares. Unset them.",
      "[test-root] MCP_ASSETS_URL has no effect: every view inlines its bundle and loads its fonts from the server's own origin. Unset it.",
      "[test-root] MCP_USE_ANONYMIZED_TELEMETRY has no effect: the server sends no telemetry. Unset it.",
    ])
  })

  it("warns about an unknown or a debug log level", async () => {
    await createComposedServer(options({ MCP_LOG_LEVEL: "loud" }))
    await createComposedServer(options({ MCP_LOG_LEVEL: "debug" }))
    expect(warnings().filter((line) => line.includes("MCP_LOG_LEVEL"))).toEqual([
      "[test-root] MCP_LOG_LEVEL=loud is not a level (info, debug, trace): the request log stays at info.",
      expect.stringMatching(
        /^\[test-root\] MCP_LOG_LEVEL=debug: the request log shows tool arguments/,
      ),
    ])
  })
})
