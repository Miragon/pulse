import { describe, expect, it } from "vitest"
import {
  CONFIG_PATH,
  fakeRuntime,
  type FakeRuntimeOptions,
} from "../../test/support/fake-runtime.js"
import { camunda7 } from "../engines/camunda7/adapter.js"
import { OperateError } from "../errors.js"
import type { CliContext } from "./context.js"
import { displayOf } from "./display.js"

function contextOf(options: FakeRuntimeOptions = {}): CliContext {
  return { runtime: fakeRuntime(options), engine: camunda7, catalog: camunda7.catalog, state: {} }
}

const TABLE_PROFILE = JSON.stringify({
  defaultProfile: "t",
  profiles: { t: { output: "table" }, j: { output: "json" } },
})

describe("displayOf", () => {
  it("prints JSON, compact, 120 columns wide when stdout is not a terminal", async () => {
    const context = contextOf()
    expect(await displayOf(context, {})).toEqual({
      format: "json",
      pretty: false,
      maxWidth: 120,
      fields: undefined,
    })
    expect(context.state.format).toBe("json")
  })

  it("prints an indented table as wide as the terminal on a terminal", async () => {
    const context = contextOf({ stdoutTTY: true, columns: 99 })
    expect(await displayOf(context, {})).toEqual({
      format: "table",
      pretty: true,
      maxWidth: 99,
      fields: undefined,
    })
    expect(context.state.format).toBe("table")
  })

  it("uses 120 columns on a terminal that reports a width of 0", async () => {
    const display = await displayOf(contextOf({ stdoutTTY: true, columns: 0 }), {})
    expect(display.maxWidth).toBe(120)
  })

  it("takes -o before PULSE_CLI_OUTPUT, which is trimmed and ignored when blank", async () => {
    const env = (value: string) => contextOf({ env: { PULSE_CLI_OUTPUT: value } })
    expect((await displayOf(env(" table "), {})).format).toBe("table")
    expect((await displayOf(env("table"), { output: "json" })).format).toBe("json")
    expect((await displayOf(env("  "), {})).format).toBe("json")
    expect((await displayOf(contextOf({ stdoutTTY: true }), { output: "json" })).format).toBe(
      "json",
    )
  })

  it("takes the output of the selected profile after PULSE_CLI_OUTPUT", async () => {
    const files = { [CONFIG_PATH]: TABLE_PROFILE }
    expect((await displayOf(contextOf({ files }), {})).format).toBe("table")
    expect((await displayOf(contextOf({ files }), { profile: "j" })).format).toBe("json")
    const env = { PULSE_CLI_OUTPUT: "json" }
    expect((await displayOf(contextOf({ files, env }), {})).format).toBe("json")
    const other = { "/other.json": TABLE_PROFILE }
    expect((await displayOf(contextOf({ files: other }), { config: "/other.json" })).format).toBe(
      "table",
    )
  })

  it("ignores a broken or missing config file and unknown profiles", async () => {
    const broken = { [CONFIG_PATH]: "{" }
    expect((await displayOf(contextOf({ files: broken }), {})).format).toBe("json")
    const files = { [CONFIG_PATH]: TABLE_PROFILE }
    expect((await displayOf(contextOf({ files }), { profile: "nope" })).format).toBe("json")
    expect((await displayOf(contextOf(), { config: "/missing.json" })).format).toBe("json")
  })

  it("indents JSON with --pretty and parses --fields", async () => {
    const display = await displayOf(contextOf(), {
      pretty: true,
      fields: "command, effect,,effect",
    })
    expect(display).toMatchObject({ pretty: true, fields: ["command", "effect"] })
  })

  it("rejects an unknown format as configuration error and records nothing", async () => {
    const context = contextOf()
    const error = await displayOf(context, { output: "yaml" }).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(OperateError)
    expect(error).toMatchObject({ code: "CONFIG", message: 'Unknown output format "yaml"' })
    expect(context.state.format).toBeUndefined()
    const fromEnv = await displayOf(contextOf({ env: { PULSE_CLI_OUTPUT: "yaml" } }), {}).catch(
      (caught: unknown) => caught,
    )
    expect(fromEnv).toMatchObject({ code: "CONFIG" })
  })
})
