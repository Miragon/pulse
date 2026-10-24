import { spawnSync } from "node:child_process"
import { describe, expect, test } from "vitest"
import { INSPECT_STACKTRACE_LINE_CAP } from "../../../../src/adapters/c7/engine-cli/index.js"
import { OPERATE_CLI_PATH } from "../support/engine-cli-binary.js"

function helpOf(...command: string[]): string {
  const result = spawnSync(process.execPath, [OPERATE_CLI_PATH, ...command, "--help"], {
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "" },
  })
  return result.stdout.replace(/\s+/g, " ")
}

describe("the bundled engine CLI", () => {
  test.each([
    [
      ["process-instance", "delete-async"],
      ["--yes", "--body"],
    ],
    [["batch", "get-statistics"], ["--batch-id"]],
    [
      ["batch", "delete"],
      ["--yes", "--[no-]cascade"],
    ],
    [["historic-process-instance", "query"], ["--body"]],
    [["batch", "suspend"], ["<id>"]],
    [["historic-batch", "get"], ["<id>"]],
    [["historic-process-instance", "query-count"], ["--body"]],
    [
      ["migration", "generate-plan"],
      ["--body", "Effect: read"],
    ],
    [
      ["migration", "validate-plan"],
      ["--body", "Effect: read"],
    ],
    [
      ["migration", "execute-plan-async"],
      ["--yes", "--body"],
    ],
    [
      ["job", "list"],
      ["--job-definition-id", "--with-exception", "--no-retries-left"],
    ],
  ])("still knows %j with %j", (command, flags) => {
    const help = helpOf(...command)

    for (const flag of flags) {
      expect(help).toContain(flag)
    }
  })

  test("still cuts inspect stacktraces at the line cap the wrapper reads truncation from", () => {
    const cap = /stacktrace \(at most (\d+) lines\)/.exec(helpOf("inspect"))?.[1]

    expect(Number(cap)).toBe(INSPECT_STACKTRACE_LINE_CAP)
  })
})
