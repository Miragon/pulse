import { describe, expect, it } from "vitest"
import {
  execute,
  fakeRuntime,
  type FakeRuntimeOptions,
} from "../../../test/support/fake-runtime.js"
import { findGuideTopic, GUIDE, GUIDE_TOPICS } from "../../docs/guide.js"
import { run } from "../run.js"

function cli(args: readonly string[], options: FakeRuntimeOptions = {}) {
  return execute(run, args, fakeRuntime(options))
}

const TOPICS = GUIDE_TOPICS.map((topic) => ({ topic: topic.name, summary: topic.summary }))

describe("pulse-cli guide", () => {
  it("prints the core guide as markdown", async () => {
    const result = await cli(["guide"])
    expect(result).toMatchObject({ code: 0, stdout: GUIDE, stderr: "" })
    expect(result.stdout).toMatch(/^# pulse-cli: /)
    expect(result.stdout.endsWith("\n")).toBe(true)
  })

  it.each(GUIDE_TOPICS.map((topic) => [topic.name, topic.text] as const))(
    "prints the topic %s as markdown",
    async (name, text) => {
      const result = await cli(["guide", name])
      expect(result).toMatchObject({ code: 0, stdout: text, stderr: "" })
      expect(result.stdout.startsWith(`# pulse-cli guide ${name}: `)).toBe(true)
    },
  )

  it("prints markdown whatever the output format", async () => {
    const auth = findGuideTopic("auth")!.text
    const cases: [readonly string[], FakeRuntimeOptions, string][] = [
      [["guide"], { stdoutTTY: true }, GUIDE],
      [["guide", "-o", "json"], {}, GUIDE],
      [["guide", "--output", "table"], { stdoutTTY: true }, GUIDE],
      [["-o", "json", "guide"], {}, GUIDE],
      [["guide"], { env: { PULSE_CLI_OUTPUT: "json" } }, GUIDE],
      [["guide", "auth", "-o", "json"], { stdoutTTY: true }, auth],
      [["guide", "auth"], { env: { PULSE_CLI_OUTPUT: "yaml" } }, auth],
    ]
    for (const [args, options, text] of cases) {
      expect(await cli(args, options)).toMatchObject({ code: 0, stdout: text, stderr: "" })
    }
  })

  it("lists the topics as JSON when piped and as a table on a terminal", async () => {
    const piped = await cli(["guide", "--list"])
    expect(piped).toMatchObject({ code: 0, stderr: "" })
    expect(piped.stdout).toBe(`${JSON.stringify(TOPICS)}\n`)
    const table = await cli(["guide", "--list"], { stdoutTTY: true, columns: 200 })
    const lines = table.stdout.trimEnd().split("\n")
    expect(lines[0]).toMatch(/^TOPIC +SUMMARY$/)
    expect(lines.slice(1)).toEqual(
      GUIDE_TOPICS.map((topic) => `${topic.name.padEnd(8)}  ${topic.summary}`),
    )
  })

  it("formats the list with -o and PULSE_CLI_OUTPUT", async () => {
    const json = await cli(["guide", "--list", "-o", "json"], { stdoutTTY: true })
    expect(JSON.parse(json.stdout)).toEqual(TOPICS)
    const table = await cli(["guide", "--list"], { env: { PULSE_CLI_OUTPUT: "table" } })
    expect(table.stdout).toMatch(/^TOPIC +SUMMARY\nworkflow +/)
    const bad = await cli(["guide", "--list", "-o", "yaml"])
    expect(bad.code).toBe(3)
  })

  it("rejects an unknown topic with suggestions and the list of topics", async () => {
    const result = await cli(["guide", "oauth"])
    expect(result).toMatchObject({ code: 2, stdout: "" })
    expect(JSON.parse(result.stderr)).toEqual({
      error: {
        code: "USAGE",
        exitCode: 2,
        message: 'Unknown guide topic "oauth"',
        hint: 'Did you mean auth? The topics are workflow, input, output, config, auth, recipes ("pulse-cli guide --list" summarizes them); "pulse-cli guide" alone prints the core guide.',
      },
    })
    const setup = JSON.parse((await cli(["guide", "setup"])).stderr) as { error: { hint: string } }
    expect(setup.error.hint).toMatch(/^The topics are workflow, /)
  })

  it("takes one topic, and none with --list", async () => {
    const two = await cli(["guide", "auth", "recipes"])
    expect(two.code).toBe(2)
    expect(JSON.parse(two.stderr)).toMatchObject({
      error: {
        message: "Too many arguments for 'guide'. Expected 1 argument but got 2: auth, recipes.",
      },
    })
    const list = await cli(["guide", "auth", "--list"])
    expect(list.code).toBe(2)
    expect(JSON.parse(list.stderr)).toEqual({
      error: {
        code: "USAGE",
        exitCode: 2,
        message: '--list takes no topic, got "auth"',
        hint: 'Run "pulse-cli guide --list" for the topics or "pulse-cli guide auth" for one topic.',
      },
    })
    const unknown = await cli(["guide", "--list", "setup"])
    expect(unknown).toMatchObject({ code: 2, stdout: "" })
    expect(JSON.parse(unknown.stderr)).toMatchObject({
      error: {
        message: '--list takes no topic, got "setup"',
        hint: 'Run "pulse-cli guide --list" for the topics.',
      },
    })
  })

  it("describes itself and its topics in its help", async () => {
    const result = await cli(["guide", "--help"])
    expect(result.stdout).toMatch(
      /^Usage: pulse-cli guide \[topic\] \[options\]\n\nPrint the usage guide/,
    )
    expect(result.stdout).toContain(
      `Topics: ${GUIDE_TOPICS.map((topic) => topic.name).join(", ")}.`,
    )
    expect(result.stdout).toMatch(/\n {2}--list +List the topics with a summary\n/)
    expect(result.stdout).toMatch(/\n {2}-o, --output <format> +Format of --list: json or table/)
  })
})
