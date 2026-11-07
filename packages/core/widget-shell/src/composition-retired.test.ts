import { afterEach, describe, expect, it, vi } from "vitest"
import { composeModules } from "./composition.js"
import { compose, moduleOf, type TestShared } from "./composition.test-support.js"

afterEach(() => {
  vi.restoreAllMocks()
})

describe("retired names", () => {
  const retiring = () =>
    compose([
      moduleOf("alpha", { retired: { names: ["alpha0"], envVars: { OLD_URL: "ALPHA_URL" } } }),
      moduleOf("beta", { retired: { envVars: { OLD_BETA_URL: "BETA_URL" } } }),
    ])
  const ONE_VARIABLE =
    "[test-root] OLD_URL is no longer read, so the server does not start with a setting it would ignore. " +
    "Rename it, the value stays: OLD_URL becomes ALPHA_URL."

  it("refuses a retired variable that is set, naming its replacement", () => {
    expect(() => retiring().resolveBoot({ OLD_URL: "http://x" })).toThrow(ONE_VARIABLE)
    expect(() => retiring().refuseRetired({ OLD_URL: "http://x" })).toThrow(ONE_VARIABLE)
  })

  it("counts a blank value: the setting is there and would be ignored", () => {
    expect(() => retiring().resolveBoot({ OLD_URL: "" })).toThrow(ONE_VARIABLE)
  })

  it("names several retired variables sorted in one message", () => {
    expect(() => retiring().resolveBoot({ OLD_URL: "x", OLD_BETA_URL: "y" })).toThrow(
      "[test-root] OLD_BETA_URL, OLD_URL are no longer read, so the server does not start with settings it would ignore. " +
        "Rename them, the values stay: OLD_BETA_URL becomes BETA_URL, OLD_URL becomes ALPHA_URL.",
    )
  })

  it("refuses a retired variable of an INACTIVE module too", () => {
    expect(() =>
      retiring().resolveBoot({ MCP_ACTIVE_MODULES: "beta", OLD_URL: "http://x" }),
    ).toThrow(ONE_VARIABLE)
  })

  it("refuses a former module name, carrying its suffix over", () => {
    expect(() => retiring().resolveBoot({ MCP_ACTIVE_MODULES: "alpha0:ops,beta" })).toThrow(
      '[test-root] MCP_ACTIVE_MODULES names "alpha0", the former name of the alpha module, so the server does not start without the module it asks for. ' +
        "Write alpha instead: alpha0:ops becomes alpha:ops.",
    )
    expect(() => retiring().resolveBoot({ MCP_ACTIVE_MODULES: "alpha0" })).toThrow(
      "Write alpha instead: alpha0 becomes alpha.",
    )
  })

  it("picks neither name silently when the former and the current one are both listed", () => {
    expect(() => retiring().resolveBoot({ MCP_ACTIVE_MODULES: "alpha0,alpha" })).toThrow(
      'MCP_ACTIVE_MODULES names "alpha0"',
    )
  })

  it("refuses the same in activeModules, emitBootWarnings and refuseRetired", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const env = { MCP_ACTIVE_MODULES: "alpha0:ops" }
    expect(() => retiring().activeModules(env)).toThrow('names "alpha0"')
    expect(() => retiring().emitBootWarnings(env)).toThrow('names "alpha0"')
    expect(() => retiring().refuseRetired(env)).toThrow('names "alpha0"')
    expect(warn).not.toHaveBeenCalled()
  })

  it("names the variable and the module name in ONE error, the variable first", () => {
    const both =
      ONE_VARIABLE +
      ' MCP_ACTIVE_MODULES names "alpha0", the former name of the alpha module, so the server does not start without the module it asks for. ' +
      "Write alpha instead: alpha0 becomes alpha."
    const env = { MCP_ACTIVE_MODULES: "alpha0", OLD_URL: "x" }
    expect(() => retiring().refuseRetired(env)).toThrow(both)
    expect(() => retiring().resolveBoot(env)).toThrow(both)
  })

  it("refuses a former module name in any case", () => {
    expect(() => retiring().resolveBoot({ MCP_ACTIVE_MODULES: "Alpha0:ops" })).toThrow(
      "Write alpha instead: Alpha0:ops becomes alpha:ops.",
    )
  })

  it("boots as before without a retired setting", () => {
    expect(() =>
      retiring().refuseRetired({ ALPHA_URL: "x", MCP_ACTIVE_MODULES: "alpha" }),
    ).not.toThrow()
    expect(retiring().resolveBoot({ MCP_ACTIVE_MODULES: "alpha" }).entries).toHaveLength(1)
    expect([...retiring().retiredEnvVars]).toEqual([
      ["OLD_URL", "ALPHA_URL"],
      ["OLD_BETA_URL", "BETA_URL"],
    ])
  })

  it("only warns on a warned retired variable, naming its replacement", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const warning = () =>
      compose([moduleOf("alpha", { retired: { warnedEnvVars: { OLD_PW: "ALPHA_PW" } } })])
    const env = { OLD_PW: "secret", MCP_ACTIVE_MODULES: "alpha" }
    expect(() => warning().refuseRetired(env)).not.toThrow()
    expect(warning().resolveBoot(env).entries).toHaveLength(1)
    expect(warning().emitBootWarnings(env)).toEqual([
      "OLD_PW is no longer read; the server reads ALPHA_PW. Rename it if it was meant for the server.",
    ])
    expect(warn).toHaveBeenCalledWith(
      "[test-root] OLD_PW is no longer read; the server reads ALPHA_PW. Rename it if it was meant for the server.",
    )
    expect(warning().emitBootWarnings({ MCP_ACTIVE_MODULES: "alpha" })).toEqual([])
    expect([...warning().retiredEnvVars]).toEqual([["OLD_PW", "ALPHA_PW"]])
  })

  // The root's own former variables (the boot's names up to 0.27) go into the same refusal.
  it("refuses the root's retired variables in the same message as the modules'", () => {
    const rooted = (appRetiredEnvVars: Record<string, string>) =>
      composeModules<TestShared>({
        label: "test-root",
        modules: [moduleOf("alpha", { retired: { envVars: { OLD_URL: "ALPHA_URL" } } })],
        appEnvVars: ["MCP_LOG_LEVEL"],
        appRetiredEnvVars,
      })
    const composition = rooted({ MCP_USE_LOG_LEVEL: "MCP_LOG_LEVEL" })
    expect(() => composition.refuseRetired({ MCP_USE_LOG_LEVEL: "debug", OLD_URL: "x" })).toThrow(
      "[test-root] MCP_USE_LOG_LEVEL, OLD_URL are no longer read, so the server does not start with settings it would ignore. " +
        "Rename them, the values stay: MCP_USE_LOG_LEVEL becomes MCP_LOG_LEVEL, OLD_URL becomes ALPHA_URL.",
    )
    expect([...composition.retiredEnvVars.keys()]).toEqual(["MCP_USE_LOG_LEVEL", "OLD_URL"])
    expect(() => rooted({ MCP_LOG_LEVEL: "X" })).toThrow(
      "The server retires the variable MCP_LOG_LEVEL, which it or a module still reads.",
    )
    expect(() => rooted({ OLD_URL: "X" })).toThrow(
      'The variable OLD_URL is retired twice (module "alpha").',
    )
  })

  it("fails to compose a table that contradicts itself", () => {
    expect(() =>
      compose([moduleOf("alpha", { retired: { names: ["beta"] } }), moduleOf("beta")]),
    ).toThrow('Module "alpha" retires the name "beta", which a composed module still carries.')
    expect(() =>
      compose([moduleOf("alpha", { retired: { names: ["Beta"] } }), moduleOf("beta")]),
    ).toThrow('Module "alpha" retires the name "Beta", which a composed module still carries.')
    expect(() =>
      compose([
        moduleOf("alpha", { retired: { envVars: { BETA_URL: "ALPHA_URL" } } }),
        moduleOf("beta"),
      ]),
    ).toThrow('Module "alpha" retires the variable BETA_URL, which a composed module still reads.')
    expect(() =>
      compose([
        moduleOf("alpha", { retired: { envVars: { OLD: "ALPHA_URL" } } }),
        moduleOf("beta", { retired: { warnedEnvVars: { OLD: "BETA_URL" } } }),
      ]),
    ).toThrow('The variable OLD is retired twice (module "beta").')
  })
})
