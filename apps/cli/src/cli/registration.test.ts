import { Command } from "commander"
import { describe, expect, it } from "vitest"
import { fakeRuntime } from "../../test/support/fake-runtime.js"
import { loadCatalog, operationsInGroup } from "../catalog/catalog.js"
import { camunda7 } from "../engines/camunda7/adapter.js"
import type { OperationSpec } from "../catalog/types.js"
import { type OptionDoc, operationOptions, usageLine } from "../docs/options.js"
import type { FlagValue } from "../operation/input.js"
import type { CliContext } from "./context.js"
import { addGlobalOptions } from "./globals.js"
import { helpConfiguration } from "./help.js"
import { registerOperation } from "./operation.js"
import { addOperationOptions, commandValues } from "./options.js"
import { createProgram } from "./program.js"

const catalog = loadCatalog()
const context: CliContext = { runtime: fakeRuntime(), engine: camunda7, catalog, state: {} }

/** Command line tokens that give every option once (repeatables twice) and the expected values. */
function everyOption(docs: readonly OptionDoc[]) {
  const tokens: string[] = []
  const expected: Record<string, FlagValue> = {}
  for (const doc of docs) {
    switch (doc.kind) {
      case "value":
        tokens.push(`--${doc.flag}`, `v-${doc.flag}`)
        expected[doc.flag] = `v-${doc.flag}`
        break
      case "repeatable":
        tokens.push(`--${doc.flag}`, "a", `--${doc.flag}`, "b")
        expected[doc.flag] = ["a", "b"]
        break
      case "presence":
        tokens.push(`--${doc.flag}`)
        expected[doc.flag] = true
        break
      case "negated":
      case "boolean":
        tokens.push(`--no-${doc.flag}`)
        expected[doc.flag] = false
        break
    }
  }
  return { tokens, expected }
}

function leafCommand(operation: OperationSpec) {
  const command = new Command(operation.name).exitOverride()
  const docs = operationOptions(operation, catalog.schemas)
  const registered = addOperationOptions(command, docs)
  addGlobalOptions(command)
  command.allowExcessArguments(true).action(() => undefined)
  return { command, docs, registered }
}

describe("registration of every catalog operation", () => {
  it("registers all groups and operations without commander errors", () => {
    const root = new Command("operate").configureHelp(helpConfiguration())
    let count = 0
    for (const group of catalog.groups) {
      const groupCommand = root.command(group.name)
      for (const operation of operationsInGroup(catalog, group.name)) {
        const command = registerOperation(groupCommand, operation, context)
        expect(command.aliases()).toEqual(operation.aliases)
        expect(command.createHelp().commandUsage(command)).toBe(usageLine(operation))
        count += 1
      }
    }
    expect(count).toBe(catalog.operations.length)
  })

  it("maps every commander attribute back to exactly one catalog flag", () => {
    for (const operation of catalog.operations) {
      const { command, registered } = leafCommand(operation)
      const flags = new Map<string, string>()
      for (const { attribute, flag } of registered) {
        expect(flags.get(attribute) ?? flag, `${operation.operationId} ${attribute}`).toBe(flag)
        flags.set(attribute, flag)
      }
      const attributes = command.options.map((option) => option.attributeName())
      const globals = attributes.filter((attribute) => !flags.has(attribute))
      expect(new Set(globals).size, operation.operationId).toBe(globals.length)
      expect(registered.map((entry) => entry.flag)).toEqual(
        operationOptions(operation, catalog.schemas).map((doc) => doc.flag),
      )
    }
  })

  it("parses every option of every operation into CommandValues", () => {
    for (const operation of catalog.operations) {
      const { command, docs, registered } = leafCommand(operation)
      const { tokens, expected } = everyOption(docs)
      command.parse(["p1", ...tokens], { from: "user" })
      expect(commandValues(command, registered), operation.operationId).toEqual({
        args: ["p1"],
        flags: expected,
      })
    }
  })

  it("registers the operations of the addressed group only", () => {
    const program = createProgram(["task", "list"], context)
    const groups = new Map(program.commands.map((command) => [command.name(), command]))
    expect(groups.get("task")?.commands.map((command) => command.name())).toEqual(
      operationsInGroup(catalog, "task").map((operation) => operation.name),
    )
    expect(groups.get("job")?.commands).toEqual([])
    const viaHelp = createProgram(["help", "job"], context)
    const job = viaHelp.commands.find((command) => command.name() === "job")
    expect(job?.commands.length).toBe(operationsInGroup(catalog, "job").length)
  })

  it("registers every group and the utility commands", () => {
    const program = createProgram([], context)
    expect(program.commands.map((command) => command.name())).toEqual([
      "commands",
      "describe",
      "guide",
      "api",
      "ping",
      "config",
      "auth",
      "completion",
      "inspect",
      "wait",
      "advance",
      "retry",
      "deploy",
      "status",
      ...catalog.groups.map((group) => group.name).toSorted(),
    ])
  })
})
