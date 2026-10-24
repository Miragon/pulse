import fc from "fast-check"
import { describe, expect, it } from "vitest"
import {
  CONFIG_PATH,
  execute,
  fakeRuntime,
  type FakeRuntimeOptions,
} from "../../test/support/fake-runtime.js"
import { COMPLETION_SCRIPTS } from "../docs/completion-scripts.js"
import { GUIDE_TOPICS } from "../docs/guide.js"
import { run } from "./run.js"

async function complete(words: readonly string[], options: FakeRuntimeOptions = {}) {
  const result = await execute(run, ["__complete", ...words], fakeRuntime(options))
  expect(result.code).toBe(0)
  expect(result.stderr).toBe("")
  return result.stdout
}

async function values(
  words: readonly string[],
  options: FakeRuntimeOptions = {},
): Promise<string[]> {
  return (await complete(words, options))
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => line.split("\t")[0] ?? "")
}

describe("operate __complete", () => {
  it.each([
    [
      [""],
      [
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
      ],
    ],
    [["proc"], ["process-definition", "process-instance", "process-instance-comment"]],
    [["task", "cl"], ["claim"]],
    [
      ["config", ""],
      ["path", "show", "list", "set", "unset", "use", "delete"],
    ],
    [
      ["task", "list", "-o", ""],
      ["json", "table"],
    ],
    [
      ["task", "list", "--auth", ""],
      ["none", "basic", "oauth", "bearer"],
    ],
    [
      ["auth", ""],
      ["login", "status", "logout"],
    ],
    [
      ["auth", "login", "--"],
      [
        "--no-browser",
        "--login-timeout",
        "--profile",
        "--config",
        "--output",
        "--timeout",
        "--verbose",
        "--help",
      ],
    ],
    [
      ["auth", "status", "--output", ""],
      ["json", "table"],
    ],
    [
      ["config", "set", "dev", "--oauth-c"],
      ["--oauth-client-id", "--oauth-client-secret-env", "--oauth-client-secret-stdin"],
    ],
    [
      ["commands", "--effect", ""],
      ["read", "write", "delete", "bulk"],
    ],
    [
      ["process-definition", "list", "--sort-order", ""],
      ["asc", "desc"],
    ],
    [
      ["wait", "--until", "ta"],
      ["task", "task:"],
    ],
    [
      ["status", "--fail-on", ""],
      ["warning", "critical"],
    ],
    [
      ["retry", "--incident-type", ""],
      ["failedJob", "failedExternalTask"],
    ],
    [
      ["completion", ""],
      ["bash", "zsh", "fish"],
    ],
    [
      ["guide", ""],
      ["workflow", "input", "output", "config", "auth", "recipes"],
    ],
    [["guide", "a"], ["auth"]],
    [["guide", "auth", ""], []],
    [
      ["guide", "--"],
      ["--list", "--output", "--help"],
    ],
    [
      ["guide", "--list", "-o", ""],
      ["json", "table"],
    ],
    [["--url", "http://x", "-o", "json", "insp"], ["inspect"]],
    [
      ["-o", ""],
      ["json", "table"],
    ],
    [
      ["config", "set", "dev", "--auth", ""],
      ["none", "basic", "oauth", "bearer"],
    ],
    [
      ["config", "set", "dev", "-o", ""],
      ["json", "table"],
    ],
    [["config", "set", "dev", "--output", "t"], ["table"]],
    [["commands", "w"], ["workflow"]],
    [["describe", "adv"], ["advance"]],
    [["describe", "task", "unc"], ["unclaim"]],
    [["help", "pi"], ["ping"]],
  ])("completes %j", async (words, expected) => {
    const found = await values(words)
    expect(found.slice(0, expected.length)).toEqual(expected)
    if (words.at(-1) !== "") expect(found).toEqual(expected)
  })

  it("offers options of the addressed command with descriptions, --no- forms included", async () => {
    expect(await values(["process-instance", "list", "--with-inc"])).toEqual(["--with-incident"])
    expect(await values(["process-instance", "list", "--no-with-inc"])).toEqual([
      "--no-with-incident",
    ])
    expect(await complete(["inspect", "--hist"])).toBe(
      "--history\tAdd the timeline: activities in BPMN order with their incidents, from the history\n",
    )
    expect(await values(["--ver"])).toEqual(["--version", "--verbose"])
  })

  it("falls back to the shell for paths", async () => {
    for (const words of [
      ["deploy", ""],
      ["deployment", "create", "x", ""],
      ["task", "list", "--out-file", ""],
      ["--config", ""],
      ["task", "complete", "t1", "--body", ""],
    ]) {
      expect(await complete(words), words.join(" ")).toBe(":files\n")
    }
    expect(await complete(["deploy", "x", "--base-dir", ""])).toBe(":dirs\n")
  })

  it("completes profile names from the config file, best effort", async () => {
    const files = { [CONFIG_PATH]: '{"profiles":{"prod":{},"local":{}}}' }
    expect(await values(["ping", "--profile", ""], { files })).toEqual(["local", "prod"])
    expect(await values(["--profile", "p"], { files })).toEqual(["prod"])
    expect(
      await values(["ping", "--profile", ""], { files: { [CONFIG_PATH]: "{broken" } }),
    ).toEqual([])
    expect(await values(["auth", "logout", "--profile", ""], { files })).toEqual(["local", "prod"])
    for (const command of ["use", "delete", "set", "unset"]) {
      expect(await values(["config", command, ""], { files }), command).toEqual(["local", "prod"])
    }
    expect(await values(["config", "use", "l"], { files })).toEqual(["local"])
    // after the profile, unset completes the keys it removes, each once
    expect(await values(["config", "unset", "prod", ""], { files })).toEqual([
      "url",
      "cockpitUrl",
      "engine",
      "platform",
      "auth",
      "output",
      "timeout",
      "headers",
      "readOnly",
      "issuer",
      "endpoints",
      "clientId",
      "clientSecret",
      "scopes",
      "audience",
      "redirectPort",
      "token",
      "tokenEnv",
    ])
    expect(await values(["config", "unset", "prod", "url", "e"], { files })).toEqual([
      "engine",
      "endpoints",
    ])
    expect(await values(["config", "unset", "prod", "engine", "e"], { files })).toEqual([
      "endpoints",
    ])
    expect(await values(["config", "unset", "prod", "url", "u"], { files })).toEqual([])
    expect(await values(["config", "use", "prod", ""], { files })).toEqual([])
  })

  it("answers nothing for ids, unknown commands and garbage, never failing", async () => {
    for (const words of [
      ["task", "complete", ""],
      ["nope", ""],
      ["task", "nope", ""],
      ["--nope", "x"],
      ["ping", "x", ""],
      ["task", "list", "--", "-x"],
      ["describe", "nope", "x"],
    ]) {
      expect(await complete(words), words.join(" ")).toBe("")
    }
    expect(await complete([])).toContain("inspect\t")
  })

  it("only offers candidates that start with the current word (property)", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom("", "p", "pro", "ta", "inspect", "-", "--", "x"),
        fc.constantFrom([], ["task"], ["inspect"], ["task", "list"]),
        async (current, before) => {
          const found = await values([...before, current])
          expect(found.every((value) => value.startsWith(current))).toBe(true)
        },
      ),
      { numRuns: 30 },
    )
  })
})

describe("operate completion", () => {
  it("prints the script of a shell", async () => {
    for (const shell of ["bash", "zsh", "fish"] as const) {
      const result = await execute(run, ["completion", shell], fakeRuntime())
      expect(result).toMatchObject({ code: 0, stdout: COMPLETION_SCRIPTS[shell], stderr: "" })
    }
  })

  it("refuses a missing or unknown shell listing the shells", async () => {
    for (const [args, message] of [
      [["completion"], "Missing shell"],
      [["completion", "powershell"], 'Unknown shell "powershell"'],
    ] as const) {
      const result = await execute(run, args, fakeRuntime())
      expect(result.code).toBe(2)
      expect(JSON.parse(result.stderr)).toMatchObject({
        error: {
          code: "USAGE",
          message,
          hint: "Pass one of bash, zsh, fish, e.g. operate completion bash.",
        },
      })
    }
  })
})

describe("operate __complete output", () => {
  it("prints values without description and commands with their first line", async () => {
    expect(await complete(["completion", ""])).toBe("bash\t\nzsh\t\nfish\t\n")
    expect(await complete(["guide", "rec"])).toBe(
      `recipes\t${GUIDE_TOPICS.find((topic) => topic.name === "recipes")!.summary}\n`,
    )
    expect(await complete(["-o", ""])).toBe("json\t\ntable\t\n")
    expect(await complete(["config", "sh"])).toBe(
      "show\tPrint the effective configuration and where each value comes from; header values, the password, the…\n",
    )
  })
})
