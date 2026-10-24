/**
 * The workflow commands in the CLI: registered next to the operation commands, listed by help,
 * `commands` and `describe`, and their comfort details.
 */

import { describe, expect, it } from "vitest"
import { errorOf, workflowSetup } from "../../../test/support/cli-workflow.js"
import {
  execute,
  fakeRuntime,
  type FakeRuntimeOptions,
} from "../../../test/support/fake-runtime.js"
import type { Stage } from "../../../test/support/workflow-engine.js"
import { run } from "../run.js"

const setup = (stage?: Stage, options?: FakeRuntimeOptions) => workflowSetup(run, stage, options)

describe("workflow commands in the CLI", () => {
  it('points "operate workflow <command>" to the top-level command', async () => {
    const { cli } = setup()
    const result = await cli(["workflow", "inspect", "pi-1"])
    expect(errorOf(result.stderr)).toEqual({
      code: "USAGE",
      exitCode: 2,
      message: 'Unknown command "workflow"',
      hint: 'Workflow commands are top-level: operate inspect. "operate commands workflow" lists them.',
    })
  })

  it("accepts global options before the command", async () => {
    const { cli } = setup()
    const result = await cli(["-o", "table", "inspect", "pi-1"])
    expect(result.stdout).toMatch(/^Process instance {2}pi-1\n/)
  })
})

describe("workflow commands in help, commands and describe", () => {
  it("documents every workflow command with requests, effect, options, global options and examples", async () => {
    const { cli } = setup()
    for (const name of ["inspect", "wait", "advance", "retry", "deploy", "status"]) {
      const { stdout, code } = await cli([name, "--help"])
      expect(code).toBe(0)
      expect(stdout).toMatch(new RegExp(`^Usage: operate ${name} `))
      const headings = stdout
        .split("\n")
        .filter((line) =>
          /^(?:Requests|Effect|Options|Global Options|Examples|Arguments):/.test(line),
        )
      expect(
        headings
          .map((line) => line.split(":")[0])
          .filter((heading, index, all) => all.indexOf(heading) === index),
      ).toEqual(
        expect.arrayContaining(["Requests", "Effect", "Options", "Global Options", "Examples"]),
      )
      expect(stdout).toContain(`\n  $ operate ${name}`)
    }
    const wait = await cli(["wait", "--help"])
    expect(wait.stdout).toContain("\nEffect: read; write with --execute-jobs\n")
    expect(wait.stdout).toMatch(/\n {2}--wait-timeout <duration> +Total wait budget like 500ms/)
  })

  it("lists the workflow commands with `commands workflow` and describes one", async () => {
    const { cli } = setup()
    const table = await cli(["commands", "workflow", "-o", "table"])
    expect(table.stdout.split("\n").slice(0, 3)).toEqual([
      "COMMAND  EFFECT  SUMMARY",
      "inspect  read    Show where a process instance waits and why: wait states, incidents with root cause, called instances,…",
      "wait     read    Wait until a process instance is idle, ended, has an incident or reached an activity, or a batch finis…",
    ])
    const described = JSON.parse((await cli(["describe", "inspect"])).stdout) as Record<
      string,
      unknown
    >
    expect(described).toMatchObject({
      command: "operate inspect [process-instance-id]",
      workflow: true,
      effect: "read",
    })
    expect((await cli(["describe", "retry", "-o", "table"])).stdout).toMatch(
      /^USAGE\n {2}operate retry \[process-instance-id\] \[options\]\n/,
    )
    expect(JSON.parse((await cli(["describe", "workflow"])).stdout)).toHaveLength(6)
    const unknown = await cli(["describe", "inspekt"])
    expect(errorOf(unknown.stderr)).toMatchObject({
      code: "USAGE",
      hint: expect.stringMatching(/^Did you mean inspect\? /),
    })
  })
})

describe("workflow comfort details", () => {
  it("keeps the other options in the ready commands of an ambiguous selection", async () => {
    const runtime = fakeRuntime({
      fetch: (input) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
        )
        const body = url.pathname.endsWith("/history/process-instance")
          ? [
              { id: "a", state: "ACTIVE" },
              { id: "b", state: "ACTIVE" },
            ]
          : []
        return Promise.resolve(
          new Response(JSON.stringify(body), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        )
      },
    })
    const result = await execute(
      run,
      [
        "advance",
        "--business-key",
        "DUP",
        "--var",
        "approved=true",
        "--wait",
        "--wait-timeout",
        "2m",
      ],
      runtime,
    )
    expect(result.code).toBe(2)
    expect(errorOf(result.stderr).hint).toBe(
      "Choose one: operate advance a --var approved=true --wait --wait-timeout 2m, operate advance b --var approved=true --wait --wait-timeout 2m; or narrow the selection with --process-definition-key <key>, or take the most recently started one with --latest.",
    )
  })

  it("says on a terminal that it waits, and nothing on a pipe", async () => {
    const terminal = setup("approve", { stderrTTY: true })
    const waited = await terminal.cli(["wait", "pi-1", "--until", "ended", "--wait-timeout", "1s"])
    expect(waited.code).toBe(9)
    expect(waited.stderr.startsWith("Waiting until ended (up to 1s; Ctrl-C to stop)...\n")).toBe(
      true,
    )
    const pipe = setup("approve")
    const quiet = await pipe.cli(["wait", "pi-1", "--until", "ended", "--wait-timeout", "1s"])
    expect(quiet.stderr).not.toContain("Waiting until")
  })
})
