import { describe, expect, test } from "vitest"
import { NodeSpawner } from "../../../../src/adapters/c7/engine-cli/index.js"

function nodeRunning(script: string, timeoutMs = 10_000) {
  return new NodeSpawner().spawn({
    command: process.execPath,
    args: ["-e", script],
    environment: { PATH: process.env.PATH ?? "" },
    timeoutMs,
  })
}

describe("the node spawner", () => {
  test("collects stdout, stderr and the exit code", async () => {
    const exit = await nodeRunning(
      'process.stdout.write("out"); process.stderr.write("err"); process.exit(3)',
    )

    expect(exit).toEqual({ exitCode: 3, timedOut: false, stdout: "out", stderr: "err" })
  })

  test("reports success as exit code 0", async () => {
    const exit = await nodeRunning('process.stdout.write("{}")')

    expect(exit).toEqual({ exitCode: 0, timedOut: false, stdout: "{}", stderr: "" })
  })

  test("stops a process that runs longer than the timeout", async () => {
    const exit = await nodeRunning("setTimeout(() => undefined, 10000)", 200)

    expect(exit.timedOut).toBe(true)
  })

  test("passes only the given environment", async () => {
    const exit = await new NodeSpawner().spawn({
      command: process.execPath,
      args: ["-e", "process.stdout.write(String(process.env.PULSE_PROBE))"],
      environment: { PULSE_PROBE: "given" },
      timeoutMs: 10_000,
    })

    expect(exit.stdout).toBe("given")
  })
})
