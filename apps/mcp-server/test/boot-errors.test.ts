import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createApp } from "../src/app.js"
import { stubNeutralEnv } from "./boot-server.js"

const FIXTURE_JS = path.join(import.meta.dirname, "fixtures", "mcp-app.js")
const boot = () => createApp(process.env, { bundle: { jsPath: FIXTURE_JS } })

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

/**
 * A setting the boot cannot use fails it with a sentence that names the variable, BEFORE the log
 * states the toolsets and the HTTP edge: lines that read like a healthy boot never precede it.
 * `src/index.ts` prints the sentence as one line through `runComposedServer`.
 */
describe("the boot refuses a setting it cannot use, before it logs the toolsets", () => {
  it.each([
    [
      "a list of engines, the form ENGINES_JSON held up to 0.27",
      { ENGINES_JSON: '[{"id":"prod-a","baseUrl":"http://localhost:8410/engine-rest"}]' },
      "ENGINES_JSON holds a JSON array, the form up to 0.27. It now holds one profile file:",
    ],
    [
      "a profile file without a usable profile",
      {
        ENGINES_JSON:
          '{"profiles":{"prod-a":{"url":"http://localhost:8410/engine-rest","headers":{}}}}',
      },
      'ENGINES_JSON: no profile is usable. Profile "prod-a" (ENGINES_JSON) is refused: This server does not apply headers',
    ],
    [
      "a defaultProfile that names no profile",
      {
        ENGINES_JSON:
          '{"defaultProfile":"prod-b","profiles":{"prod-a":{"url":"http://localhost:8410/engine-rest"}}}',
      },
      "ENGINES_JSON: defaultProfile names no profile of this file. It must name one of its profiles: prod-a.",
    ],
    [
      "an engine URL without a scheme",
      { ENGINE_BASE_URL: "localhost:8410/engine-rest" },
      "ENGINE_BASE_URL: url must start with http:// or https://.",
    ],
    [
      "the generic OpenID Connect provider without its issuer",
      { MCP_URL: "http://localhost:8400", MCP_OAUTH_OIDC_AUDIENCE: "https://pulse.example/mcp" },
      "OpenID Connect OAuth needs MCP_OAUTH_OIDC_ISSUER, which is unset while MCP_OAUTH_OIDC_AUDIENCE is set.",
    ],
    [
      "the generic OpenID Connect provider with a caller claim another person may get later",
      {
        MCP_URL: "http://localhost:8400",
        MCP_OAUTH_OIDC_ISSUER: "https://fs.example/adfs",
        MCP_OAUTH_OIDC_SUBJECT_CLAIM: "upn",
      },
      'OpenID Connect OAuth (MCP_OAUTH_OIDC_ISSUER, MCP_OAUTH_OIDC_SUBJECT_CLAIM) is invalid: MCP_OAUTH_OIDC_SUBJECT_CLAIM "upn" names a claim whose value can change',
    ],
    [
      "the generic OpenID Connect provider with an audience a client id can be, and no scope",
      {
        MCP_URL: "http://localhost:8400",
        MCP_OAUTH_OIDC_ISSUER: "https://auth.example/application/o/pulse/",
        MCP_OAUTH_OIDC_AUDIENCE: "pulse-client",
      },
      'MCP_OAUTH_OIDC_AUDIENCE names "pulse-client", which is no https URL',
    ],
    [
      "the web sign-in's scopes without its client",
      { MCP_WEB_SCOPES: "openid" },
      "MCP_WEB_SCOPES is set, but MCP_WEB_CLIENT_ID is not, so the web app stays off.",
    ],
    [
      "an unknown module",
      { MCP_ACTIVE_MODULES: "engines:operations,analytic" },
      '[pulse] MCP_ACTIVE_MODULES names the unknown modules "engines", "analytic", so the server does not start without the modules it asks for. Known modules: engine.',
    ],
    [
      "the analytics module, gone with Prometheus, unknown like any other",
      { MCP_ACTIVE_MODULES: "engine:operations,analytics" },
      '[pulse] MCP_ACTIVE_MODULES names an unknown module "analytics", so the server does not start without the module it asks for. Known modules: engine.',
    ],
    [
      "the name the engine module carried up to 0.24, unknown like any other",
      { MCP_ACTIVE_MODULES: "camunda7:operations" },
      '[pulse] MCP_ACTIVE_MODULES names an unknown module "camunda7", so the server does not start without the module it asks for. Known modules: engine.',
    ],
  ])("%s", async (_case, env, message) => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {})
    vi.spyOn(console, "warn").mockImplementation(() => {})
    stubNeutralEnv(env)
    await expect(boot()).rejects.toThrow(message)
    expect(info).not.toHaveBeenCalled()
  })

  /** The image fills `web/` beside `dist/`; a checkout holds none. */
  it("refuses the web app without its build, at the package's web folder by default", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {})
    vi.spyOn(console, "warn").mockImplementation(() => {})
    stubNeutralEnv({
      MCP_URL: "http://localhost:8400",
      MCP_OAUTH_KEYCLOAK_SERVER_URL: "http://localhost:8480",
      MCP_OAUTH_KEYCLOAK_REALM: "miragon",
      MCP_WEB_CLIENT_ID: "pulse-web",
      MCP_WEB_CLIENT_SECRET: "change-me",
      MCP_WEB_SESSION_KEYS: Buffer.alloc(32, 7).toString("base64url"),
    })
    const web = path.join(import.meta.dirname, "..", "web")
    await expect(boot()).rejects.toThrow(
      `MCP_WEB_CLIENT_ID is set, but ${web} holds no web build (no index.html and no pages.json): build the web app into it, or set MCP_WEB_DIR to the folder it was built into.`,
    )
    expect(info).not.toHaveBeenCalled()
  })

  /** `bootWarnings` names the ids of a passthrough engine: only a profile the server took. */
  it("logs no secret of an engine setting in front of its error", async () => {
    const SECRET = "pl4nted-S3cret"
    const info = vi.spyOn(console, "info").mockImplementation(() => {})
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    stubNeutralEnv({
      ENGINES_JSON: JSON.stringify({
        profiles: {
          a: {
            url: `https://svc:${SECRET}@engine.example/engine-rest`,
            auth: { type: "passthrough" },
          },
          [`${SECRET} b`]: { url: "http://b.example/engine-rest" },
        },
      }),
      ENGINE_DEFAULT: `${SECRET}-other`,
    })
    const refused = (await boot().catch((error: unknown) => error)) as Error
    expect(refused.message).toContain(
      'Profile "a" (ENGINES_JSON) is refused: url must not contain credentials',
    )
    expect(refused.message).not.toContain(SECRET)
    expect(JSON.stringify([info.mock.calls, warn.mock.calls])).not.toContain(SECRET)
  })
})

/** `src/index.ts` itself, imported as `node dist/index.js` runs it: a revert to its own listen fails here. */
describe("the entry prints a refused setting as one line and exits 1", () => {
  it("names the server and the setting, logs nothing before it and shows no stack", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {})
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const written: string[] = []
    vi.spyOn(process.stderr, "write").mockImplementation(
      (chunk: string | Uint8Array, ...rest: unknown[]) => {
        written.push(String(chunk))
        const done = rest.find((arg) => typeof arg === "function") as (() => void) | undefined
        done?.()
        return true
      },
    )
    // A real exit would end the test run: the stand-in rejects the entry's import instead.
    const exit = vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit(${String(code)})`)
    })
    stubNeutralEnv({ MCP_ACTIVE_MODULES: "engines" })
    await expect(import("../src/index.js")).rejects.toThrow("process.exit(1)")
    expect(written).toEqual([
      '[pulse] The server did not start: MCP_ACTIVE_MODULES names an unknown module "engines", so the server does not start without the module it asks for. Known modules: engine.\n',
    ])
    expect(exit).toHaveBeenCalledExactlyOnceWith(1)
    expect(info).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
  })
})
