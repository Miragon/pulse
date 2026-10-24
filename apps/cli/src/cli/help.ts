/**
 * Help output: commander output wiring, option terms (`--[no-]x`), usage lines without aliases, the
 * texts of the root help (intro, exit codes) and the examples section of operation commands.
 */

import type { Command, HelpConfiguration, Option, OutputConfiguration } from "commander"
import { EXIT_CODES } from "../errors.js"
import type { Runtime } from "../runtime.js"
import { terminalColumns } from "./output-format.js"

/** Help width when stdout is not a terminal (commander's default). */
const DEFAULT_HELP_WIDTH = 80

const HELP_TERMS = new WeakMap<Option, string>()

/** Shows `term` instead of the commander flags in the help, e.g. `--[no-]skip-io-mappings`. */
export function setHelpTerm(option: Option, term: string): void {
  HELP_TERMS.set(option, term)
}

function ancestorNames(command: Command): string[] {
  const names: string[] = []
  for (let parent = command.parent; parent !== null; parent = parent.parent) {
    names.unshift(parent.name())
  }
  return names
}

/** `pulse-cli group command`: the names from the root to the command. */
export function commandPath(command: Command): string {
  return [...ancestorNames(command), command.name()].join(" ")
}

export function helpConfiguration(): HelpConfiguration {
  return {
    optionTerm: (option) => HELP_TERMS.get(option) ?? option.flags,
    // the usage line shows the command name only; aliases are listed in the description
    commandUsage: (command) => [commandPath(command), command.usage()].join(" ").trimEnd(),
    // command lists show `claim <id>`: no aliases and no "[options]" (commander adds both, which
    // made the rows of the process-definition help 185 characters wide)
    subcommandTerm: (command) =>
      `${command.name()} ${command.usage().replace("[options]", "")}`.replace(/\s+/g, " ").trim(),
  }
}

/** commander writes through the runtime; it never prints errors itself (run() renders them). */
export function outputConfiguration(runtime: Runtime): OutputConfiguration {
  const { stdout } = runtime
  const width = () => terminalColumns(runtime) ?? DEFAULT_HELP_WIDTH
  return {
    writeOut: (text) => {
      stdout.write(text)
    },
    // commander writes help to its error stream only when a command is missing (`pulse-cli task`);
    // that help is the answer to the call, so it goes to stdout like `--help` does
    writeErr: (text) => {
      stdout.write(text)
    },
    outputError: () => undefined,
    getOutHelpWidth: width,
    getErrHelpWidth: width,
    getOutHasColors: () => false,
    getErrHasColors: () => false,
  }
}

/**
 * The "Examples:" section after the help of an operation command, separated by a blank line; empty
 * (nothing printed) without examples. Examples stay on one line each, so they paste into a shell.
 */
export function examplesText(examples: readonly string[]): string {
  if (examples.length === 0) return ""
  return ["", "Examples:", ...examples.map((example) => `  $ ${example}`)].join("\n")
}

/** Root help description: what pulse-cli is and how to start. commander wraps the paragraphs. */
export const ROOT_DESCRIPTION = [
  "AI-first command line interface for the Camunda 7 REST API (Operaton, CIB seven, Camunda 7). Every REST operation is a command: pulse-cli <group> <command> [arguments] [options]. Output is JSON when stdout is not a terminal, errors are one JSON line on stderr, and nothing ever prompts.",
  "",
  "The REST API root defaults to http://localhost:8080/engine-rest; set it with --url, PULSE_CLI_URL or a profile (pulse-cli config set).",
  "",
  "Basic auth: --auth-user <name> with the password piped into --auth-password-stdin, PULSE_CLI_USERNAME and PULSE_CLI_PASSWORD, or a profile (pulse-cli config set <profile> --auth basic --auth-user <name> --auth-password-env <VAR>).",
  "",
  'OAuth: a person runs "pulse-cli auth login --profile <name>" once in a terminal; commands then refresh the token on their own.',
  "",
  "Bearer token from elsewhere (SSO tooling, a CI secret): PULSE_CLI_TOKEN, --auth-token-stdin or a profile (pulse-cli config set <profile> --auth bearer --auth-token-env <VAR>); PULSE_CLI_TOKEN_COMMAND names a command that prints one (pulse-cli guide auth).",
  "",
  "Get started:",
  "  pulse-cli ping                        check the connection to the engine",
  "  pulse-cli commands                    list the API groups",
  "  pulse-cli commands --search <text>    find a command",
  "  pulse-cli describe <group> <command>  options, body, responses, examples",
  "  pulse-cli inspect <id>                where an instance waits and why",
  "  pulse-cli status                      incidents, jobs and workers at a glance",
  "  pulse-cli guide                       usage guide for agents (markdown)",
].join("\n")

/** Meaning of every exit code. */
const EXIT_CODE_MEANINGS: Readonly<Record<keyof typeof EXIT_CODES, string>> = {
  ok: "success",
  internal: "internal error",
  usage: "usage error, invalid body (VALIDATION), READ_ONLY, CONFIRMATION_REQUIRED",
  config: "configuration error, or an HTTP redirect (wrong --url)",
  auth: "not authenticated or authorized (401, 403), LOGIN_REQUIRED, LOGIN_FAILED, TOKEN_EXPIRED",
  notFound: "not found (404)",
  client: "other 4xx: the engine rejected the request",
  server: "engine error (5xx)",
  network: "network error or timeout",
  outcome:
    "the process did not reach the expected state (WAIT_TIMEOUT, INCIDENT, INSTANCE_ENDED, JOB_FAILED, CHECK_FAILED)",
}

/** Width of the exit code table: meanings wrap below themselves to stay within 80 columns. */
const EXIT_TABLE_WIDTH = 80

/** `  <code>  <meaning>`, continued on lines indented below the meaning. */
function exitCodeEntry(code: number, meaning: string): string[] {
  const lines: string[] = []
  let line = `  ${code} `
  for (const word of meaning.split(" ")) {
    if (line.length + 1 + word.length > EXIT_TABLE_WIDTH) {
      lines.push(line)
      line = "    "
    }
    line += ` ${word}`
  }
  return [...lines, line]
}

/** The exit code table of the root help, ordered by code. */
export function exitCodeLines(): string[] {
  return Object.entries(EXIT_CODES)
    .sort(([, left], [, right]) => left - right)
    .flatMap(([key, code]) =>
      exitCodeEntry(code, EXIT_CODE_MEANINGS[key as keyof typeof EXIT_CODES]),
    )
}

/** Text after the root help: where to look next and the exit codes. */
export function rootFooter(): string {
  return [
    "",
    'Run "pulse-cli <group> --help" for the commands of a group and',
    '"pulse-cli <group> <command> --help" for the options of a command.',
    "",
    "Exit codes:",
    ...exitCodeLines(),
  ].join("\n")
}
