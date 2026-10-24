import { describe, expect, it } from "vitest"
import { CONFIG_PATH, fakeRuntime } from "../../test/support/fake-runtime.js"
import { camunda7 } from "../engines/camunda7/adapter.js"
import type { ResolvedConfig } from "../config/types.js"
import { configPath, isExplicit } from "./config-files.js"
import type { CliContext } from "./context.js"
import type { GlobalOptions } from "./globals.js"
import {
  clientOf,
  guardsOf,
  openSession,
  readOnlySource,
  renderOptionsOf,
  targetOf,
} from "./session.js"

const NONE: GlobalOptions = {
  headers: [],
  pretty: false,
  dryRun: false,
  yes: false,
  readOnly: false,
  verbose: false,
  showSecrets: false,
  authPasswordStdin: false,
  authTokenStdin: false,
}

function context(runtime = fakeRuntime()): CliContext {
  return { runtime, engine: camunda7, catalog: camunda7.catalog, state: {} }
}

function config(sources: Partial<ResolvedConfig["sources"]>, profile?: string): ResolvedConfig {
  return {
    ...(profile === undefined ? {} : { profile }),
    url: "http://h/engine-rest",
    platform: "camunda7",
    auth: { type: "none" },
    timeoutMs: 1000,
    headers: {},
    readOnly: true,
    sources: {
      url: "default",
      engine: "default",
      platform: "default",
      auth: "default",
      output: "default",
      timeout: "default",
      headers: "default",
      readOnly: "default",
      ...sources,
    },
  }
}

describe("openSession", () => {
  it("resolves the configuration and records the output format", async () => {
    const ctx = context(fakeRuntime({ env: { OPERATE_OUTPUT: "table" } }))
    const session = await openSession(ctx, { ...NONE, fields: "id, name", engine: "e" })
    expect(session).toMatchObject({
      configPath: CONFIG_PATH,
      format: "table",
      pretty: false,
      fields: ["id", "name"],
      config: { engine: "e", url: "http://localhost:8080/engine-rest" },
    })
    expect(ctx.state.format).toBe("table")
  })

  it("chooses table and pretty output on a terminal, JSON otherwise", async () => {
    const tty = await openSession(context(fakeRuntime({ stdoutTTY: true })), NONE)
    expect([tty.format, tty.pretty]).toEqual(["table", true])
    const pipe = await openSession(context(), { ...NONE, pretty: true })
    expect([pipe.format, pipe.pretty, pipe.fields]).toEqual(["json", true, undefined])
  })

  it("reads the profile from the config file", async () => {
    const file = JSON.stringify({ defaultProfile: "p", profiles: { p: { url: "http://p/rest" } } })
    const session = await openSession(context(fakeRuntime({ files: { "/c.json": file } })), {
      ...NONE,
      config: "/c.json",
    })
    expect(session.config).toMatchObject({ profile: "p", url: "http://p/rest" })
    expect(session.configPath).toBe("/c.json")
  })
})

describe("session helpers", () => {
  it("requires a config file named by --config or OPERATE_CONFIG, not the default one", async () => {
    const missing = await openSession(context(), { ...NONE, config: "/typo.json" }).catch(
      (error: unknown) => error,
    )
    expect(missing).toMatchObject({
      code: "CONFIG",
      message: "Config file /typo.json does not exist",
    })
    const fromEnv = await openSession(
      context(fakeRuntime({ env: { OPERATE_CONFIG: "/env.json" } })),
      NONE,
    ).catch((error: unknown) => error)
    expect(fromEnv).toMatchObject({ message: "Config file /env.json does not exist" })
    const fallback = await openSession(context(), NONE)
    expect(fallback.configPath).toBe(CONFIG_PATH)
    expect(isExplicit(fakeRuntime({ env: { OPERATE_CONFIG: " " } }), undefined)).toBe(false)
  })

  it("chooses the config path", () => {
    expect(configPath(fakeRuntime(), "/x.json")).toBe("/x.json")
  })

  it("names the source of read-only mode", () => {
    expect(readOnlySource(config({ readOnly: "flag" }))).toBe("--read-only")
    expect(readOnlySource(config({ readOnly: "env" }))).toBe("OPERATE_READ_ONLY")
    expect(readOnlySource(config({ readOnly: "profile" }, "prod"))).toBe('profile "prod"')
    expect(readOnlySource(config({ readOnly: "profile" }))).toBe('profile ""')
    expect(readOnlySource(config({}))).toBeUndefined()
  })

  it("builds target, guards, client and render options", async () => {
    const runtime = fakeRuntime({ columns: 70, stdoutTTY: true })
    const session = await openSession(context(runtime), {
      ...NONE,
      engine: "e",
      headers: ["X-A: 1"],
      yes: true,
      readOnly: true,
      verbose: true,
    })
    expect(targetOf(session)).toEqual({
      baseUrl: "http://localhost:8080/engine-rest",
      engine: "e",
      headers: { "X-A": "1" },
    })
    expect(guardsOf(session)).toEqual({
      readOnly: true,
      readOnlySource: "--read-only",
      yes: true,
      dryRun: false,
    })
    const client = clientOf(session, runtime)
    expect(client.timeoutMs).toBe(30_000)
    expect(client.now()).toBe(runtime.now())
    expect(await client.auth.headers()).toEqual({})
    client.trace?.({ type: "request", method: "GET", url: "http://x", headers: {} })
    expect(runtime.stderr.text()).toBe("> GET http://x\n")
    expect(renderOptionsOf(session, runtime, "bpmn20Xml")).toEqual({
      format: "table",
      pretty: true,
      fields: undefined,
      maxWidth: 70,
      unwrap: "bpmn20Xml",
      showSecrets: false,
      baseUrl: "http://localhost:8080/engine-rest",
    })
  })

  it("builds a target without engine, guards without source and a client without trace", async () => {
    const runtime = fakeRuntime()
    const session = await openSession(context(runtime), NONE)
    expect(targetOf(session)).toEqual({
      baseUrl: "http://localhost:8080/engine-rest",
      headers: {},
    })
    expect(guardsOf(session)).toEqual({ readOnly: false, yes: false, dryRun: false })
    expect(clientOf(session, runtime).trace).toBeUndefined()
  })
})
