/** The plain completion model the CLI builds from its commander program. */

import { describe, expect, it } from "vitest"
import { CONFIG_PATH, fakeRuntime } from "../../test/support/fake-runtime.js"
import { loadCatalog } from "../catalog/catalog.js"
import { camunda7 } from "../engines/camunda7/adapter.js"
import type { CompletionCommand } from "../docs/completion.js"
import { completionContext } from "./completion-model.js"
import type { CliContext } from "./context.js"

const catalog = loadCatalog()

function cliContext(files: Record<string, string> = {}): CliContext {
  return { runtime: fakeRuntime({ files }), engine: camunda7, catalog, state: {} }
}

const HELP = {
  flags: ["--help", "-h"],
  takesValue: false,
  description: "Display help for command",
}

function byName(commands: readonly CompletionCommand[], name: string): CompletionCommand {
  const found = commands.find((command) => command.name === name)
  if (found === undefined) throw new Error(`no command ${name}`)
  return found
}

describe("completionContext", () => {
  it("models the root with its options, the commands with their kind and the help command", async () => {
    const { root } = await completionContext(cliContext(), [""])
    const { commands, ...rest } = root
    expect(rest).toEqual({
      name: "pulse-cli",
      aliases: [],
      description: "",
      kind: "command",
      options: [
        { flags: ["--version", "-V"], takesValue: false, description: "Print the version" },
        HELP,
      ],
    })
    expect(
      ["commands", "config", "inspect", "deploy", "task", "help"].map((name) => [
        name,
        byName(commands, name).kind,
      ]),
    ).toEqual([
      ["commands", "utility"],
      ["config", "utility"],
      ["inspect", "workflow"],
      ["deploy", "workflow"],
      ["task", "group"],
      ["help", "utility"],
    ])
    expect(commands.at(-1)).toEqual({
      name: "help",
      aliases: [],
      description: "Display help for a command",
      kind: "utility",
      options: [],
      commands: [],
      positional: { kind: "top-level" },
    })
    expect(byName(commands, "deploy").positional).toEqual({ kind: "path", path: "files" })
    expect(byName(commands, "ping").positional).toBeUndefined()
  })

  it("takes the summary, else the first line of the description", async () => {
    const { root } = await completionContext(cliContext(), ["config", ""])
    expect(byName(root.commands, "commands").description).toBe(
      "List the API groups and their commands; search all commands",
    )
    const config = byName(root.commands, "config")
    expect(byName(config.commands, "path")).toMatchObject({
      description:
        "Print the location of your config file; with --project the project file in effect, else where `config set --project` creates one",
      kind: "command",
      commands: [],
    })
    const descriptions = [...root.commands, ...config.commands].map(
      (command) => command.description,
    )
    expect(descriptions.filter((text) => text === "" || text.includes("\n"))).toEqual([])
  })

  it("registers only the group of the first path word after the global options", async () => {
    const counts = async (words: string[]) => {
      const { root } = await completionContext(cliContext(), words)
      return ["task", "process-instance"].map((name) => byName(root.commands, name).commands.length)
    }
    expect(await counts(["-o", "json", "task", ""])).toEqual([22, 0])
    expect(await counts(["--url", "http://x", "--pretty", "task"])).toEqual([22, 0])
    expect(await counts(["process-instance", "list", ""])).toEqual([0, 27])
    expect(await counts(["-o"])).toEqual([0, 0])
    expect(await counts([])).toEqual([0, 0])
  })

  it("models options: flags, values, paths, profiles and the help option", async () => {
    const { root } = await completionContext(cliContext(), ["task", "claim", ""])
    const claim = byName(byName(root.commands, "task").commands, "claim")
    expect(claim).toMatchObject({
      name: "claim",
      aliases: [],
      description: "Claim a task for a user",
      kind: "command",
      commands: [],
    })
    expect(claim.positional).toBeUndefined()
    const option = (flag: string) => claim.options.find((entry) => entry.flags[0] === flag)
    expect(option("--user-id")).toEqual({
      flags: ["--user-id"],
      takesValue: true,
      description: "The id of the user that the current action refers to.",
    })
    expect(option("--body")).toMatchObject({ takesValue: true, path: "files" })
    expect(option("--no-validate")).toMatchObject({ flags: ["--no-validate"], takesValue: false })
    expect(option("--yes")).toMatchObject({ flags: ["--yes", "-y"], takesValue: false })
    expect(option("--output")).toMatchObject({ values: ["json", "table"] })
    expect(option("--profile")).toMatchObject({ profiles: true })
    expect(option("--profile")).not.toHaveProperty("values")
    expect(claim.options.at(-1)).toEqual(HELP)
  })

  it("models the global options and the groups on demand", async () => {
    const model = await completionContext(cliContext(), [""])
    expect(model.globals[0]).toEqual({
      flags: ["--url"],
      takesValue: true,
      description: "REST API root, e.g. http://localhost:8080/engine-rest (env PULSE_CLI_URL)",
    })
    expect(model.globals.find((option) => option.flags[0] === "--output")).toEqual({
      flags: ["--output", "-o"],
      takesValue: true,
      description: "json or table; default: table on a terminal, else json (env PULSE_CLI_OUTPUT)",
      values: ["json", "table"],
    })
    expect(model.group("task")).toMatchObject({ name: "task", kind: "group" })
    expect(model.group("task")?.commands).toHaveLength(22)
    expect(model.group("inspect")).toBeUndefined()
    expect(model.group("config")).toBeUndefined()
    expect(model.group("nope")).toBeUndefined()
  })

  it("reads the profile names of the config file, also of --config, best effort", async () => {
    const profiles = '{"profiles":{"prod":{},"local":{}}}'
    const at = async (files: Record<string, string>, words: string[]) =>
      (await completionContext(cliContext(files), words)).profiles
    expect(await at({ [CONFIG_PATH]: profiles }, [""])).toEqual(["local", "prod"])
    expect(await at({ "/x/c.json": profiles }, ["--config", "/x/c.json", ""])).toEqual([
      "local",
      "prod",
    ])
    expect(await at({}, [""])).toEqual([])
    expect(await at({ [CONFIG_PATH]: "{broken" }, [""])).toEqual([])
  })
})
