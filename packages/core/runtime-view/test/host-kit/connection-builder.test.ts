import {
  BulkOperationId,
  type ProcessCommands,
  type ProcessRuntime,
} from "@miragon/pulse-engine-core"
import { describe, expect, test } from "vitest"
import { EngineLane } from "../../src/core/index.js"
import type { CliTarget, EngineCli, EngineWebUi } from "../../src/ports/index.js"
import {
  ConnectionBuilder,
  type ConnectionSettings,
} from "../../src/host-kit/connections/connection-builder.js"
import type { Credentials, EngineFactories } from "../../src/host-kit/connections/connection.js"
import type { EngineTarget } from "../../src/host-kit/connections/engine-target.js"
import { LOCAL_TARGET } from "./support/local-target.js"
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
const REMOTE_C8: EngineTarget = {
  ...LOCAL,
  name: "c8-saas",
  engine: "c8",
  endpoint: "https://bru-2.api.camunda.io/cluster/v2",
  auth: { kind: "clientCredentials", tokenEndpoint: "https://login.cloud.camunda.io/oauth/token" },
}
const REMOTE_PLAIN_HTTP: EngineTarget = {
  ...LOCAL_BASIC,
  name: "shop-eu",
  endpoint: "http://shop-eu.example.com/engine-rest",
}

function factories(
  commands: ProcessCommands | undefined,
  webUi?: EngineWebUi,
  asked: EngineTarget[] = [],
  canWrite = true,
): EngineFactories {
  return {
    runtime: () => ({}) as ProcessRuntime,
    commands: (target) => {
      asked.push(target)
      return commands
    },
    canWrite: () => canWrite,
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

  test("carries the engine's CLI, which names the profile of a file's target with its URL and the URL of the default engine", () => {
    const named: CliTarget[] = []
    const cli: EngineCli = { triggerCommand: () => undefined }
    const engines: EngineFactories = {
      ...factories(COMMANDS),
      cli: (_, cliTarget) => {
        named.push(cliTarget)
        return cli
      },
    }
    const fromFile: EngineTarget = {
      ...LOCAL,
      endpoint: "http://localhost:8112/engine-rest",
      source: { kind: "file", path: "/shop/.pulse.json" },
    }

    const connection = builderOver(engines).build(
      fromFile,
      NO_LOGIN,
      "local",
      settings("localOnly"),
    )
    builderOver(engines).build(LOCAL_TARGET, NO_LOGIN, "local", settings("localOnly"))
    builderOver(engines).build(
      {
        ...fromFile,
        source: { kind: "user-config", path: "/home/dev/.config/pulse-cli/config.json" },
      },
      NO_LOGIN,
      "local",
      settings("localOnly"),
    )

    expect(connection.cli).toBe(cli)
    expect(named).toEqual([
      { kind: "profile", name: "shop-dev", endpoint: "http://localhost:8112/engine-rest" },
      { kind: "endpoint", endpoint: "http://localhost:8080/engine-rest" },
      { kind: "profile", name: "shop-dev", endpoint: "http://localhost:8112/engine-rest" },
    ])
  })

  test.each([
    ["on this machine", LOCAL, "enabled"],
    ["on a remote host, where the write policy would ask to allow writes", REMOTE_C8, "localOnly"],
    ["with writes turned off", REMOTE_C8, "disabled"],
  ] as const)(
    "says that Pulse only reads an engine whose adapter brings no commands, %s",
    (_, target, writes) => {
      const asked: EngineTarget[] = []
      const connection = builderOver(factories(COMMANDS, undefined, asked, false)).build(
        target,
        NO_LOGIN,
        "unclassified",
        settings(writes),
      )

      expect(asked).toEqual([])
      expect(connection.commands).toBeUndefined()
      expect(connection.badge.access).toEqual({
        writable: false,
        note: "Read-only. Pulse reads this engine and changes no data on it.",
      })
    },
  )

  test.each([
    [
      "a client secret it would send over plain HTTP",
      {
        ...REMOTE_C8,
        auth: { kind: "clientCredentials", tokenEndpoint: "http://login.example.com/oauth/token" },
      },
      NO_LOGIN,
      "Read-only. c8-saas would send its client secret over plain HTTP. Use an https token endpoint.",
    ],
    [
      "a client secret saved for another endpoint",
      REMOTE_C8,
      { kind: "savedForAnotherEndpoint", savedFor: "https://evil.example.com" },
      "Read-only. The endpoint of c8-saas moved from https://evil.example.com to https://bru-2.api.camunda.io and https://login.cloud.camunda.io since you saved its credentials. Check the change, then set the credentials again.",
    ],
  ] as const)(
    "names the refusal of an engine whose adapter brings no commands, for %s",
    (_, target, credentials, note) => {
      const connection = builderOver(factories(COMMANDS, undefined, [], false)).build(
        target,
        credentials,
        "unclassified",
        settings("enabled"),
      )

      expect(connection.commands).toBeUndefined()
      expect(connection.badge.access).toEqual({ writable: false, note })
    },
  )

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
