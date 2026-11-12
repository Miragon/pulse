import {
  BulkOperationId,
  type ProcessCommands,
  type ProcessRuntime,
} from "@miragon/pulse-engine-core"
import { describe, expect, test } from "vitest"
import { EngineLane } from "../../src/core/index.js"
import type { EngineCli, EngineWebUi } from "../../src/ports/index.js"
import {
  ConnectionBuilder,
  type ConnectionSettings,
} from "../../src/host-kit/connections/connection-builder.js"
import type { Credentials, EngineFactories } from "../../src/host-kit/connections/connection.js"
import { LOCAL_TARGET, type EngineTarget } from "../../src/host-kit/connections/engine-target.js"
import { TargetPolicy } from "../../src/host-kit/connections/target-policy.js"
import { WriteAudit } from "../../src/host-kit/connections/write-audit.js"

const NO_LOGIN: Credentials = { kind: "none" }
const LOGIN: Credentials = { kind: "basic", username: "demo", password: "demo" }
const WORDING = { setting: "the writes setting", enableOnRemote: "Allow writes on remote engines" }

const COMMANDS: ProcessCommands = {
  retryIncident: () => Promise.resolve(),
  setVariable: () => Promise.resolve(),
  moveToken: () => Promise.resolve(),
  cancelInstances: () => Promise.resolve(BulkOperationId("bulk-1")),
  migrateInstances: () => Promise.resolve(BulkOperationId("bulk-2")),
  stopBulkOperation: () => Promise.resolve(),
}

const COCKPIT: EngineWebUi = {
  name: "Cockpit",
  overviewUrl: () => "",
  instanceUrl: () => "",
  definitionUrl: () => "",
}

const LOCAL: EngineTarget = { ...LOCAL_TARGET, name: "shop-dev" }
const LOCAL_BASIC: EngineTarget = { ...LOCAL, auth: { kind: "basic" } }
const LOCAL_OAUTH: EngineTarget = { ...LOCAL, auth: { kind: "oauth2" } }
const REMOTE_PLAIN_HTTP: EngineTarget = {
  ...LOCAL_BASIC,
  name: "shop-eu",
  endpoint: "http://shop-eu.example.com/engine-rest",
}

function factories(
  commands: ProcessCommands | undefined,
  webUi?: EngineWebUi,
  asked: EngineTarget[] = [],
): EngineFactories {
  return {
    runtime: () => ({}) as ProcessRuntime,
    commands: (target) => {
      asked.push(target)
      return commands
    },
    webUi: () => webUi,
    cli: () => undefined,
  }
}

function builderOver(engines: EngineFactories): ConnectionBuilder {
  return new ConnectionBuilder(engines, new WriteAudit({ info: () => undefined }), WORDING)
}

function builder(
  commands: ProcessCommands | undefined,
  webUi?: EngineWebUi,
  asked: EngineTarget[] = [],
): ConnectionBuilder {
  return builderOver(factories(commands, webUi, asked))
}

function settings(writes: ConnectionSettings["writes"]): ConnectionSettings {
  return { writes, live: undefined, lane: new EngineLane() }
}

describe("a connection the host kit builds", () => {
  test("carries audited commands, the login it writes as and the engine's web UI", () => {
    const asked: EngineTarget[] = []
    const connection = builder(COMMANDS, COCKPIT, asked).build(
      LOCAL_BASIC,
      LOGIN,
      "local",
      settings("localOnly"),
    )

    expect(asked).toEqual([LOCAL_BASIC])
    expect(connection.commands).toBeDefined()
    expect(connection.commands).not.toBe(COMMANDS)
    expect(connection.identity).toBe("demo")
    expect(connection.webUi).toBe(COCKPIT)
    expect(connection.badge).toMatchObject({ name: "shop-dev", webUi: "Cockpit" })
    expect(connection.badge.access?.writable).toBe(true)
    expect(connection.live.setting).toBe("on")
  })

  test("keeps the note of the write policy when the policy says no, and asks for no commands", () => {
    const asked: EngineTarget[] = []
    const connection = builder(COMMANDS, undefined, asked).build(
      LOCAL,
      NO_LOGIN,
      "local",
      settings("disabled"),
    )

    expect(asked).toEqual([])
    expect(connection.commands).toBeUndefined()
    expect(connection.badge.access).toEqual({
      writable: false,
      note: "Read-only. Writes are turned off with the writes setting.",
    })
    expect(connection).not.toHaveProperty("identity")
    expect(connection).not.toHaveProperty("webUi")
    expect(connection).not.toHaveProperty("cli")
    expect(connection.badge).not.toHaveProperty("webUi")
  })

  test("carries the engine's CLI, run with the profile of the project file and none for the default engine", () => {
    const profiles: (string | undefined)[] = []
    const cli: EngineCli = { triggerCommand: () => undefined }
    const engines: EngineFactories = {
      ...factories(COMMANDS),
      cli: (_, profile) => {
        profiles.push(profile)
        return cli
      },
    }
    const fromFile: EngineTarget = { ...LOCAL, source: { kind: "file", path: "/shop/.pulse.json" } }

    const connection = builderOver(engines).build(
      fromFile,
      NO_LOGIN,
      "local",
      settings("localOnly"),
    )
    builderOver(engines).build(LOCAL_TARGET, NO_LOGIN, "local", settings("localOnly"))

    expect(connection.cli).toBe(cli)
    expect(profiles).toEqual(["shop-dev", undefined])
  })

  test("says that Pulse does not change data when the engine brings no commands", () => {
    const connection = builder(undefined).build(LOCAL, NO_LOGIN, "local", settings("localOnly"))

    expect(connection.commands).toBeUndefined()
    expect(connection.badge.access).toEqual({
      writable: false,
      note: "Read-only. Pulse does not change data on this engine.",
    })
  })

  test("names the refusal of its target, the way to write, when the target is refused", () => {
    const plainHttp = builder(undefined).build(
      REMOTE_PLAIN_HTTP,
      LOGIN,
      "unclassified",
      settings("enabled"),
    )
    const oauth = builder(undefined).build(LOCAL_OAUTH, NO_LOGIN, "local", settings("localOnly"))

    expect(plainHttp.badge.access).toEqual({
      writable: false,
      note: "Read-only. shop-eu would send basic credentials over plain HTTP. Use an https endpoint.",
    })
    expect(oauth.badge.access).toEqual({
      writable: false,
      note: `Read-only. ${String(TargetPolicy.refusal(LOCAL_OAUTH, NO_LOGIN))}`,
    })
    expect(oauth.badge.access?.note).toContain("Set auth.type to none")
    expect(plainHttp.identity).toBe("demo")
  })
})
