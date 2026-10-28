import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

// Outside `src/widgets`: it reads sources from disk (Node APIs).
const SRC = fileURLToPath(new URL("./", import.meta.url))

/**
 * A direct call would lose the wrapper's override (#328): text endpoints answer JSON
 * with 406, variable reads deserialize Object values eagerly. `home` names the one
 * module here allowed the raw call.
 */
const TASK_COMPLETION = { wrapper: "completeUserTask", home: "lib/task-completion.ts" }
const CONTRACT_WRAPPED: Record<string, { wrapper: string; home?: string }> = {
  getStacktrace: { wrapper: "fetchJobStacktrace" },
  getExternalTaskErrorDetails: { wrapper: "fetchExternalTaskErrorDetails" },
  getProcessInstanceVariables: { wrapper: "readProcessInstanceVariables" },
  getTaskVariables: { wrapper: "readTaskVariables" },
  // A task's completion endpoint follows from the task: `/submit-form` runs
  // its form fields but resets omitted defaults and RESOLVES a delegated task,
  // `/complete` validates nothing, `/resolve` hands a delegated task back.
  complete: TASK_COMPLETION,
  submit: TASK_COMPLETION,
  resolve: TASK_COMPLETION,
}

function sources(): Array<{ file: string; text: string }> {
  return readdirSync(SRC, { recursive: true, encoding: "utf8" })
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
    .map((file) => ({ file, text: readFileSync(join(SRC, file), "utf8") }))
}

/** Names imported from the generated SDK, per file. */
function sdkImports(text: string): string[] {
  return [...text.matchAll(/import\s*\{([^}]*)\}\s*from\s*"@miragon\/pulse-camunda7-client\/sdk"/g)]
    .flatMap((m) => m[1].split(","))
    .map((name) => name.trim().split(/\s+as\s+/)[0])
    .filter(Boolean)
}

describe("engine calls with a contract override go through the engine contract", () => {
  it("finds the SDK imports (the scan is not vacuous)", () => {
    expect(sources().filter(({ text }) => sdkImports(text).length > 0).length).toBeGreaterThan(10)
  })

  it.each(Object.entries(CONTRACT_WRAPPED))(
    "no module calls %s directly",
    (raw, { wrapper, home }) => {
      for (const { file, text } of sources()) {
        if (file === home) continue
        expect(
          sdkImports(text),
          `${file}: use ${wrapper} (engine contract) instead of the raw SDK ${raw}`,
        ).not.toContain(raw)
      }
    },
  )

  it("each in-package home really makes its raw calls (the exemption is not stale)", () => {
    const homed = Object.entries(CONTRACT_WRAPPED).filter(([, { home }]) => home !== undefined)
    expect(homed.length).toBeGreaterThan(0)
    for (const [raw, { home }] of homed) {
      const source = sources().find(({ file }) => file === home)
      expect(source, `${home} is missing`).toBeDefined()
      expect(sdkImports(source?.text ?? ""), `${home} should import ${raw}`).toContain(raw)
    }
  })

  it("engine dates are written by toEngineDate, never by a local rewrite", () => {
    for (const { file, text } of sources()) {
      expect(text, `${file}: use toEngineDate from the engine contract`).not.toMatch(
        /\.replace\(\s*["']Z["']\s*,\s*["']\+0000["']\s*\)/,
      )
    }
  })
})
