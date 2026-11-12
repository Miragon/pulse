import { describe, expect, it } from "vitest"
import { CONFIG_PATH, execute, fakeRuntime } from "../../test/support/fake-runtime.js"
import { selectEngine } from "./flavor.js"
import { run } from "./run.js"

const PROFILES = JSON.stringify({
  defaultProfile: "local",
  profiles: { local: { flavor: "operaton" }, other: { flavor: "cibseven" } },
})

async function engineOf(argv: readonly string[], env: Record<string, string> = {}) {
  const runtime = fakeRuntime({ env, files: { [CONFIG_PATH]: PROFILES } })
  return (await selectEngine(argv, runtime)).name
}

describe("selectEngine", () => {
  it("takes --flavor, then PULSE_CLI_FLAVOR, then the selected profile", async () => {
    const env = { PULSE_CLI_FLAVOR: "camunda7" }
    expect(await engineOf(["ping", "--flavor", "cibseven"], env)).toBe("cibseven")
    expect(await engineOf(["ping"], env)).toBe("camunda7")
    expect(await engineOf(["ping"])).toBe("operaton")
    expect(await engineOf(["ping", "--profile", "other"])).toBe("cibseven")
    expect(await engineOf(["ping"], { PULSE_CLI_PROFILE: "other" })).toBe("cibseven")
  })

  it("takes no profile's flavor for a --url alone, a profile's for config set's --url", async () => {
    expect(await engineOf(["ping", "--url", "http://x"])).toBe("camunda7")
    expect(await engineOf(["ping", "--url", "http://x"], { PULSE_CLI_PROFILE: "other" })).toBe(
      "camunda7",
    )
    expect(await engineOf(["ping", "--url", "http://x", "--profile", "other"])).toBe("cibseven")
    expect(await engineOf(["config", "set", "p", "--url", "http://x"])).toBe("operaton")
  })

  it("uses camunda7 without a flavor and when the config cannot be read", async () => {
    expect((await selectEngine(["ping"], fakeRuntime())).name).toBe("camunda7")
    expect(await engineOf(["ping", "--profile", "missing"])).toBe("camunda7")
    const broken = fakeRuntime({ files: { [CONFIG_PATH]: "{" } })
    expect((await selectEngine(["ping"], broken)).name).toBe("camunda7")
  })
})

describe("run with an unknown flavor", () => {
  it("fails with the list of known engines", async () => {
    const result = await execute(run, ["ping", "--flavor", "camunda8"], fakeRuntime())
    expect(result.code).toBe(3)
    expect(JSON.parse(result.stderr)).toMatchObject({
      error: {
        code: "CONFIG",
        message: 'Unknown flavor "camunda8"',
        hint: "Use one of: operaton, cibseven, camunda7",
      },
    })
  })
})

describe("platform, the name of flavor before the move to Pulse", () => {
  it("is an unknown key of a profile", async () => {
    const files = { [CONFIG_PATH]: JSON.stringify({ profiles: { p: { platform: "operaton" } } }) }
    const result = await execute(run, ["config", "show", "--profile", "p"], fakeRuntime({ files }))
    expect(result.code).toBe(3)
    expect(JSON.parse(result.stderr)).toMatchObject({
      error: {
        code: "CONFIG",
        message: 'Profile "p" of your config file cannot be used: platform is no key of a profile.',
        hint: "Remove it with `pulse config unset p platform`, or fix its spelling in the file.",
      },
    })
  })

  it("is no option", async () => {
    const result = await execute(run, ["ping", "--platform", "operaton"], fakeRuntime())
    expect(result.code).toBe(2)
    expect(JSON.parse(result.stderr)).toMatchObject({ error: { code: "USAGE" } })
  })

  it("is no variable", async () => {
    expect(await engineOf(["ping"], { PULSE_CLI_PLATFORM: "cibseven" })).toBe("operaton")
    expect(
      (await selectEngine(["ping"], fakeRuntime({ env: { PULSE_CLI_PLATFORM: "x" } }))).name,
    ).toBe("camunda7")
  })
})
