/**
 * The command line of scripts/local.mjs, the script behind the root `pnpm stack:*`, `play*`,
 * `test:one` and `check*` commands (pure; scripts/local-args.test.mjs).
 */

/** Every command with the options it takes, and its `operands` when it takes arguments too. */
export const COMMANDS = {
  "stack:up": {
    options: ["--multi-engine", "--auth", "--jdk-container"],
    summary: "start the playground in Docker and wait until it answers",
  },
  "stack:down": { options: ["--wipe"], summary: "stop the playground (--wipe: its volumes too)" },
  "stack:status": { options: [], summary: "what runs, healthy or not, and the URLs" },
  play: {
    options: ["--multi-engine", "--auth", "--admin", "--deploy", "--jdk-container"],
    summary: "install, start the playground, build and run the MCP server with its inspector",
  },
  "play:cli": { options: [], summary: "the built CLI against the playground engine" },
  "test:one": {
    options: ["--watch"],
    operands: "file",
    summary: "test files in their packages, coverage off, the packages under them built first",
  },
  check: { options: ["--force"], summary: "the standard local bar, one log per step" },
  "check:all": {
    options: ["--force", "--jdk-container"],
    summary: "check plus host simulation, template, Gradle, docs and engine suites",
  },
}

/** `--multi-engine` → `multiEngine`. */
const optionKey = (option) => option.slice(2).replace(/-(\w)/g, (_, c) => c.toUpperCase())

export const USAGE = [
  "Usage: pnpm <command> [options]",
  "",
  ...Object.entries(COMMANDS).map(
    ([name, { options, summary }]) =>
      `  ${name.padEnd(13)} ${summary}${options.length > 0 ? ` (${options.join(", ")})` : ""}`,
  ),
  "",
  "pnpm play:cli -- <args> passes everything after -- to the CLI; pnpm -s play:cli -- <args>",
  "leaves stdout to the CLI alone (pnpm prints its script banner there), for a pipe.",
  "pnpm test:one <file...> is the inner loop; pnpm test keeps enforcing the coverage floors.",
].join("\n")

/**
 * `{ command, options, rest }` for `argv` (without node and the script), or an Error naming what
 * is wrong. play:cli passes every argument on to the CLI (a leading `--` dropped); a command
 * with `operands` needs at least one, in `rest`; `--deploy` implies `--admin`, since deployments
 * register only in the admin toolset.
 */
export function parseArgs(argv) {
  const [command, ...args] = argv
  const spec = COMMANDS[command]
  if (spec === undefined) {
    return new Error(command === undefined ? "No command given." : `Unknown command: ${command}`)
  }
  if (command === "play:cli") {
    return { command, options: {}, rest: args[0] === "--" ? args.slice(1) : args }
  }
  const options = Object.fromEntries(spec.options.map((option) => [optionKey(option), false]))
  const rest = []
  for (const arg of args) {
    if (arg === "--") continue
    if (spec.operands !== undefined && !arg.startsWith("-")) {
      rest.push(arg)
      continue
    }
    if (!spec.options.includes(arg)) {
      const known = spec.options.length > 0 ? spec.options.join(", ") : "none"
      return new Error(`${command} does not take ${arg} (its options: ${known})`)
    }
    options[optionKey(arg)] = true
  }
  if (spec.operands !== undefined && rest.length === 0) {
    return new Error(`${command} needs at least one ${spec.operands}`)
  }
  if (options.deploy) options.admin = true
  return { command, options, rest }
}
