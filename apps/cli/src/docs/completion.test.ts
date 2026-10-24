import { spawnSync } from "node:child_process"
import { describe, expect, it } from "vitest"
import {
  type CompletionCommand,
  type CompletionContext,
  complete,
  formatCompletion,
} from "./completion.js"
import { COMPLETION_SCRIPTS, INSTALL_LINES, SHELLS } from "./completion-scripts.js"

const leaf: CompletionCommand = {
  name: "list",
  aliases: ["get-list"],
  description: "List things",
  kind: "command",
  options: [
    { flags: ["--sort-order"], takesValue: true, description: "Order", values: ["asc", "desc"] },
    { flags: ["--all"], takesValue: false, description: "All pages" },
    { flags: ["-x"], takesValue: false, description: "short only" },
    { flags: ["--file"], takesValue: true, description: "A file", path: "files" },
    { flags: ["--profile"], takesValue: true, description: "A profile", profiles: true },
    { flags: ["--id"], takesValue: true, description: "An id" },
  ],
  commands: [],
  positional: { kind: "values", values: ["alpha", "beta"] },
}

function command(
  name: string,
  kind: CompletionCommand["kind"],
  extra: Partial<CompletionCommand> = {},
): CompletionCommand {
  return {
    name,
    aliases: [],
    description: `${name} text`,
    kind,
    options: [],
    commands: [],
    ...extra,
  }
}

const thing = command("thing", "group", { description: "Things", commands: [leaf] })

const context: CompletionContext = {
  root: {
    name: "operate",
    aliases: [],
    description: "",
    kind: "command",
    options: [
      { flags: ["--version", "-V"], takesValue: false, description: "Version" },
      { flags: ["-q"], takesValue: false, description: "short only" },
    ],
    commands: [
      thing,
      command("wait", "workflow"),
      command("ping", "utility"),
      command("commands", "utility", { positional: { kind: "groups" } }),
      command("describe", "utility", { positional: { kind: "describe" } }),
      command("help", "utility", { positional: { kind: "top-level" } }),
      command("deploy", "workflow", { positional: { kind: "path", path: "files" } }),
      command("config", "utility", {
        commands: [command("use", "command"), command("show", "command")],
      }),
    ],
  },
  globals: [
    {
      flags: ["--output", "-o"],
      takesValue: true,
      description: "Format",
      values: ["json", "table"],
    },
    { flags: ["--verbose"], takesValue: false, description: "Trace" },
    { flags: ["--base"], takesValue: true, description: "A directory", path: "dirs" },
  ],
  group: (name) => (name === "thing" ? thing : undefined),
  profiles: ["local", "prod"],
}

const NONE = { kind: "candidates", candidates: [] }

/** The values offered after the words; the last word is the one being completed. */
function offered(...words: string[]): string[] | string {
  const result = complete(context, words.slice(0, -1), words.at(-1) ?? "")
  return result.kind === "path"
    ? `:${result.path}`
    : result.candidates.map((candidate) => candidate.value)
}

describe("complete", () => {
  it("offers the commands with descriptions and the root and global options at the root", () => {
    expect(complete(context, [], "th")).toEqual({
      kind: "candidates",
      candidates: [{ value: "thing", description: "Things" }],
    })
    expect(offered("")).toEqual([
      "thing",
      "wait",
      "ping",
      "commands",
      "describe",
      "help",
      "deploy",
      "config",
    ])
    expect(complete(context, [], "--v")).toEqual({
      kind: "candidates",
      candidates: [
        { value: "--version", description: "Version" },
        { value: "--verbose", description: "Trace" },
      ],
    })
    expect(offered("-")).toEqual(["--version", "--output", "--verbose", "--base"])
    expect(offered("x")).toEqual([])
  })

  it("skips global options with their values before the command path", () => {
    expect(offered("-o", "")).toEqual(["json", "table"])
    expect(offered("--output", "t")).toEqual(["table"])
    expect(offered("--base", "")).toBe(":dirs")
    expect(offered("-o", "json", "th")).toEqual(["thing"])
    expect(offered("-o=json", "th")).toEqual(["thing"])
    expect(offered("--verbose", "th")).toEqual(["thing"])
    expect(offered("--verbose", "-o", "json", "--verbose", "pi")).toEqual(["ping"])
    expect(offered("--output", "json", "-")).toEqual([
      "--version",
      "--output",
      "--verbose",
      "--base",
    ])
    expect(offered("-o", "json", "thing", "")).toEqual(["list"])
    expect(complete(context, ["--nope"], "")).toEqual(NONE)
    expect(complete(context, ["--nope", "x"], "")).toEqual(NONE)
  })

  it("finds the command of a group by name or alias, and the subcommands of a command", () => {
    expect(complete(context, ["thing"], "")).toEqual({
      kind: "candidates",
      candidates: [{ value: "list", description: "List things" }],
    })
    expect(offered("thing", "get-list", "")).toEqual(["alpha", "beta"])
    expect(offered("config", "")).toEqual(["use", "show"])
    expect(offered("config", "s")).toEqual(["show"])
    expect(offered("config", "use", "")).toEqual([])
    expect(offered("thing", "--x", "")).toEqual(["list"])
    expect(offered("ping", "")).toEqual([])
    expect(complete(context, ["thing", "nope"], "")).toEqual(NONE)
    expect(complete(context, ["nope"], "")).toEqual(NONE)
    expect(complete(context, ["nope", "list"], "")).toEqual(NONE)
  })

  it("offers the long options of the command for a dash", () => {
    expect(complete(context, ["thing", "list"], "--s")).toEqual({
      kind: "candidates",
      candidates: [{ value: "--sort-order", description: "Order" }],
    })
    expect(offered("thing", "list", "-")).toEqual([
      "--sort-order",
      "--all",
      "--file",
      "--profile",
      "--id",
    ])
    expect(offered("thing", "list", "alpha", "--a")).toEqual(["--all"])
    expect(offered("thing", "list", "--", "--a")).toEqual(["--all"])
  })

  it("completes option values: enums, paths, profiles; nothing for free values", () => {
    expect(offered("thing", "get-list", "--sort-order", "d")).toEqual(["desc"])
    expect(offered("thing", "list", "--file", "")).toBe(":files")
    expect(offered("thing", "list", "--profile", "p")).toEqual(["prod"])
    expect(offered("thing", "list", "--profile", "")).toEqual(["local", "prod"])
    expect(offered("thing", "list", "--id", "")).toEqual([])
    expect(offered("thing", "list", "--all", "--sort-order", "")).toEqual(["asc", "desc"])
  })

  it("counts positionals, skipping option values and stopping options at --", () => {
    expect(offered("thing", "list", "a")).toEqual(["alpha"])
    expect(offered("thing", "list", "--sort-order=asc", "")).toEqual(["alpha", "beta"])
    expect(offered("thing", "list", "--sort-order", "asc", "")).toEqual(["alpha", "beta"])
    expect(offered("thing", "list", "--all", "")).toEqual(["alpha", "beta"])
    expect(offered("thing", "list", "-x", "")).toEqual(["alpha", "beta"])
    expect(offered("thing", "list", "--unknown", "")).toEqual(["alpha", "beta"])
    expect(offered("thing", "list", "--id", "alpha", "")).toEqual(["alpha", "beta"])
    expect(offered("thing", "list", "alpha", "")).toEqual([])
    expect(offered("thing", "list", "-", "")).toEqual([])
    expect(offered("thing", "list", "--", "")).toEqual(["alpha", "beta"])
    expect(offered("thing", "list", "--", "-x", "")).toEqual([])
    expect(offered("thing", "list", "--", "--sort-order", "")).toEqual([])
  })

  it("completes the positionals of commands, help, describe and paths", () => {
    expect(offered("help", "p")).toEqual(["ping"])
    expect(offered("help", "")).toHaveLength(8)
    expect(offered("help", "ping", "")).toEqual([])
    expect(complete(context, ["commands"], "")).toEqual({
      kind: "candidates",
      candidates: [
        { value: "thing", description: "Things" },
        { value: "workflow", description: "The workflow commands" },
      ],
    })
    expect(offered("commands", "x")).toEqual([])
    expect(offered("describe", "")).toEqual(["thing", "wait", "deploy", "workflow"])
    expect(offered("describe", "w")).toEqual(["wait", "workflow"])
    expect(offered("describe", "wo")).toEqual(["workflow"])
    expect(offered("describe", "thing", "l")).toEqual(["list"])
    expect(offered("describe", "thing", "list", "")).toEqual([])
    expect(offered("describe", "nope", "")).toEqual([])
    expect(offered("deploy", "")).toBe(":files")
    expect(offered("deploy", "a.bpmn", "")).toBe(":files")
  })

  it("describes positional values that come with descriptions", () => {
    const guide = command("guide", "utility", {
      positional: {
        kind: "values",
        values: ["auth", "input", "constructor"],
        descriptions: { auth: "Auth" },
      },
    })
    const withGuide = { ...context, root: { ...context.root, commands: [guide] } }
    expect(complete(withGuide, ["guide"], "")).toEqual({
      kind: "candidates",
      candidates: [
        { value: "auth", description: "Auth" },
        { value: "input", description: "" },
        { value: "constructor", description: "" },
      ],
    })
    expect(complete(withGuide, ["guide", "auth"], "")).toEqual(NONE)
  })
})

describe("formatCompletion", () => {
  it("prints value and one-line description per candidate, or the path marker", () => {
    expect(formatCompletion({ kind: "path", path: "dirs" })).toBe(":dirs\n")
    expect(formatCompletion({ kind: "path", path: "files" })).toBe(":files\n")
    const long = "x".repeat(150)
    expect(
      formatCompletion({
        kind: "candidates",
        candidates: [
          { value: "a", description: "one\ttwo\nthree" },
          { value: "b", description: long },
          { value: "c", description: " \u0007bell\r\n\n end " },
          { value: "d", description: "y".repeat(100) },
          { value: "e", description: "z".repeat(101) },
          { value: "f", description: "" },
        ],
      }),
    ).toBe(
      [
        "a\tone two three",
        `b\t${"x".repeat(99)}…`,
        "c\tbell  end",
        `d\t${"y".repeat(100)}`,
        `e\t${"z".repeat(99)}…`,
        "f\t",
        "",
      ].join("\n"),
    )
    expect(formatCompletion({ kind: "candidates", candidates: [] })).toBe("")
  })
})

describe("completion scripts", () => {
  it("call operate __complete and fall back to path completion", () => {
    expect(SHELLS).toEqual(["bash", "zsh", "fish"])
    const { bash, zsh, fish } = COMPLETION_SCRIPTS
    // bash 3.2 has no compopt: the function quotes paths and adds "/" or the space itself
    expect(bash).toContain("complete -o nospace -F _operate_complete operate\n")
    expect(bash).not.toContain("compopt ")
    expect(bash).toContain('done < <(operate __complete "${words[@]}" 2>/dev/null)')
    expect(bash).toContain('compgen -d -- "${cur#@}"')
    expect(bash).toContain(`printf '%q' "$1"`)
    expect(bash).toContain('if [[ "$candidate" != *: ]]; then candidate="$candidate "; fi')
    expect(bash.split("\n")[1]).toBe('#   eval "$(operate completion bash)"')
    expect(zsh.startsWith("#compdef operate\n")).toBe(true)
    expect(zsh).toContain("_describe 'operate' candidates")
    // activity: and task: are prefixes: no space after them
    expect(zsh).toContain("_describe 'operate' prefixes -S ''")
    expect(zsh).toContain("compset -P '@'")
    expect(zsh).toContain("_files -/")
    expect(zsh).toContain("//:/\\\\:")
    expect(fish).toContain("complete -c operate -f -a '(__operate_complete)'")
    expect(fish).toContain('__fish_complete_path "$current"')
    expect(INSTALL_LINES.join("\n")).not.toContain("source <(")
  })

  it.skipIf(spawnSync("bash", ["--version"]).status !== 0)("is valid bash", () => {
    expect(spawnSync("bash", ["-n"], { input: COMPLETION_SCRIPTS.bash }).status).toBe(0)
  })

  it.skipIf(spawnSync("zsh", ["--version"]).status !== 0)("is valid zsh", () => {
    expect(spawnSync("zsh", ["-n"], { input: COMPLETION_SCRIPTS.zsh }).status).toBe(0)
  })
})
