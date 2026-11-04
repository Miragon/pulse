import { afterEach, describe, expect, it, vi } from "vitest"
import { execute, fakeRuntime } from "../../test/support/fake-runtime.js"
import { FLAVORS } from "../config/types.js"
import { run } from "./run.js"

async function candidates(words: readonly string[]): Promise<string[]> {
  const printed: string[] = []
  vi.spyOn(console, "log").mockImplementation((line: unknown) => {
    printed.push(String(line))
  })
  const result = await execute(run, ["complete", "--", ...words], fakeRuntime())
  expect(result.code).toBe(0)
  return printed.filter((line) => !line.startsWith(":"))
}

async function names(words: readonly string[]): Promise<string[]> {
  return (await candidates(words)).map((line) => line.split("\t")[0] ?? "")
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("shell completion", () => {
  it("completes groups and workflow commands with their one-line summary", async () => {
    expect(await candidates(["ins"])).toEqual([
      "inspect\tShow where a process instance waits and why: wait states, incidents with root cause, called instances, variables",
    ])
    expect(await names(["process-inst"])).toEqual(["process-instance", "process-instance-comment"])
  })

  it("completes the commands of a group, one line each", async () => {
    const lines = await candidates(["process-instance", ""])
    expect(lines).toContain("list\tList process instances")
    expect(lines.every((line) => /^[a-z][\w-]*\t/.test(line))).toBe(true)
  })

  it("completes the options of an operation", async () => {
    expect(await names(["process-instance", "list", "--business-key"])).toEqual([
      "--business-key",
      "--business-key-like",
    ])
  })

  it("offers the allowed values of operation and global options", async () => {
    expect(await names(["process-instance", "list", "--sort-order", ""])).toEqual(["asc", "desc"])
    expect(await names(["process-instance", "list", "--output", ""])).toEqual(["json", "table"])
    expect(await names(["ping", "--flavor", ""])).toEqual([...FLAVORS])
  })
})

describe("shell completion scripts", () => {
  it.each(["bash", "zsh", "fish", "powershell"])("prints the %s script", async (shell) => {
    const printed: string[] = []
    vi.spyOn(console, "log").mockImplementation((line: unknown) => {
      printed.push(String(line))
    })
    const result = await execute(run, ["completion", shell], fakeRuntime())
    expect(result.code).toBe(0)
    expect(printed.join("\n")).toMatch(/pulse-cli complete '?--/)
  })
})
