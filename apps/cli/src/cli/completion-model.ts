/**
 * The hidden `pulse-cli __complete <words...>` of the completion scripts: builds the
 * commander program for the words (lazy registration registers only the addressed group), turns
 * it into the plain model of src/docs/completion.ts and prints the candidates. Never touches the
 * network or stdin, writes nothing to stderr and never fails.
 */

import type { Command, Option } from "commander"
import { findGroup } from "../catalog/catalog.js"
import {
  type CompletionCommand,
  type CompletionContext,
  type CompletionOption,
  complete,
  formatCompletion,
} from "../docs/completion.js"
import { CLI_NAME, compact } from "../util.js"
import { globalFromArgv, globalOptionLength } from "./argv.js"
import { optionCompletion, positionalOf } from "./completion-meta.js"
import { loadConfig } from "./config-files.js"
import type { CliContext } from "./context.js"
import { globalOptionObjects } from "./globals.js"
import { createProgram } from "./program.js"
import { WORKFLOW_COMMANDS } from "./workflow/index.js"

/** The command name of the completion scripts. */
export const COMPLETE_COMMAND = "__complete"

const HELP_OPTION: CompletionOption = {
  flags: ["--help", "-h"],
  takesValue: false,
  description: "Display help for command",
}

function optionModel(option: Option): CompletionOption {
  const completion = optionCompletion(option)
  const values = completion?.values ?? option.argChoices
  return {
    flags: [option.long, option.short].filter((flag) => flag !== undefined),
    takesValue: option.required || option.optional,
    description: option.description,
    ...compact({ values, path: completion?.path, profiles: completion?.profiles }),
  }
}

function kindOf(context: CliContext, name: string): CompletionCommand["kind"] {
  if (WORKFLOW_COMMANDS.includes(name)) return "workflow"
  return findGroup(context.catalog, name) === undefined ? "utility" : "group"
}

function commandModel(command: Command, kind: CompletionCommand["kind"]): CompletionCommand {
  const summary = command.summary()
  const description = summary === "" ? command.description().replace(/\n[\s\S]*$/, "") : summary
  return {
    name: command.name(),
    aliases: command.aliases(),
    description,
    kind,
    options: [...command.options.map(optionModel), HELP_OPTION],
    commands: command.commands.map((sub) => commandModel(sub, "command")),
    ...compact({ positional: positionalOf(command) }),
  }
}

function rootModel(program: Command, context: CliContext): CompletionCommand {
  const help: CompletionCommand = {
    name: "help",
    aliases: [],
    description: "Display help for a command",
    kind: "utility",
    options: [],
    commands: [],
    positional: { kind: "top-level" },
  }
  return {
    name: CLI_NAME,
    aliases: [],
    description: "",
    kind: "command",
    options: [...program.options.map(optionModel), HELP_OPTION],
    commands: [
      ...program.commands.map((command) => commandModel(command, kindOf(context, command.name()))),
      help,
    ],
  }
}

/** The words of the command path after the leading global options. */
function pathWords(words: readonly string[]): string[] {
  let index = 0
  for (let length = globalOptionLength(words, 0); length > 0 && index + length < words.length;) {
    index += length
    length = globalOptionLength(words, index)
  }
  return words.slice(index)
}

/**
 * Profile names of the config file (`--config`, PULSE_CLI_CONFIG) or of the project file and the
 * user's config file, best effort.
 */
async function profileNames(context: CliContext, words: readonly string[]): Promise<string[]> {
  try {
    const { config } = await loadConfig(context.runtime, globalFromArgv(words, "config"))
    return Object.keys(config?.profiles ?? {}).sort()
  } catch {
    return []
  }
}

/** The completion model for the words (exported for tests). */
export async function completionContext(
  context: CliContext,
  words: readonly string[],
): Promise<CompletionContext> {
  const [first = ""] = pathWords(words)
  const program = createProgram([first], context)
  const group = (name: string) => {
    const command = createProgram([name], context).commands.find(
      (candidate) => candidate.name() === name,
    )
    return command === undefined || kindOf(context, name) !== "group"
      ? undefined
      : commandModel(command, "group")
  }
  return {
    root: rootModel(program, context),
    globals: globalOptionObjects().map(optionModel),
    group,
    profiles: await profileNames(context, words),
  }
}

/** Prints the candidates for the words; garbage gives no output, never an error. */
export async function runComplete(words: readonly string[], context: CliContext): Promise<void> {
  try {
    const before = words.slice(0, -1)
    const current = words.at(-1) ?? ""
    const completion = complete(await completionContext(context, words), before, current)
    context.runtime.stdout.write(formatCompletion(completion))
  } catch {
    // completion must never disturb the shell
  }
}
