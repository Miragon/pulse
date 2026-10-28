import { ESLint } from "eslint"
import { describe, expect, test } from "vitest"
import { readRepoFile, REPO_ROOT } from "./support/files.js"

const PROBE_FILE = "apps/vscode/src/core/incidents/root-cause.ts"
const CLASS_PROBE = "apps/vscode/src/contract/model/value-kinds.ts"
const COMPONENT_PROBE = "apps/vscode/src/webview/components/icon.tsx"

const eslint = new ESLint({ cwd: REPO_ROOT })

async function rulesFiredOn(text: string, filePath = PROBE_FILE): Promise<string[]> {
  const [result] = await eslint.lintText(text, { filePath })
  return (result?.messages ?? []).map((message) => message.ruleId ?? message.message)
}

function withProbe(line: string): string {
  return `${readRepoFile(PROBE_FILE)}\n${line}\n`
}

describe("the lint gates", { timeout: 120_000 }, () => {
  test("the probe file is clean as it is", async () => {
    expect(await rulesFiredOn(readRepoFile(PROBE_FILE))).toEqual([])
  })

  test("reject comments of every kind", async () => {
    const commented = `// explain\n/* block */\n${readRepoFile(PROBE_FILE)}`
    expect(await rulesFiredOn(commented)).toEqual([
      "pulse-vscode/no-comments",
      "pulse-vscode/no-comments",
    ])
  })

  test("cannot be switched off inline", async () => {
    const disabled = `/* eslint-disable */\n${readRepoFile(PROBE_FILE)}`
    expect(await rulesFiredOn(disabled)).toContain("pulse-vscode/no-comments")
  })

  test("allow no console call outside the dev tools and scripts", async () => {
    const logging = withProbe(
      "export const log = (): void => {\n  console.error(1)\n  console.warn(2)\n  console.log(3)\n}",
    )
    const fired = await rulesFiredOn(logging)
    expect(fired.filter((rule) => rule === "no-console")).toHaveLength(3)
  })

  test("enforce the complexity budget", async () => {
    const branches = Array.from(
      { length: 11 },
      (_, index) => `  if (value === ${index}) return ${index};`,
    )
    const complex = withProbe(
      `export function tangled(value: number): number {\n${branches.join("\n")}\n  return -1;\n}`,
    )
    expect(await rulesFiredOn(complex)).toContain("complexity")
  })

  test.each([
    "export const processDefinitionKey = 1;",
    "export const engine = 'Camunda 7';",
    "export const label = `zeebe ${String(1)}`;",
    "export type Engine = 'c8';",
  ])("keep engine words out of the core: %s", async (line) => {
    expect(await rulesFiredOn(withProbe(line))).toContain("no-restricted-syntax")
  })

  test.each([
    "apps/vscode/src/contract/ports/process-runtime.ts",
    "apps/vscode/src/contract/model/ids.ts",
  ])("keep engine words out of the contract: %s", async (filePath) => {
    expect(await rulesFiredOn(readRepoFile(filePath), filePath)).toEqual([])
    const probe = `${readRepoFile(filePath)}\nexport type Key = 'processInstanceKey';\n`
    expect(await rulesFiredOn(probe, filePath)).toEqual(["no-restricted-syntax"])
  })

  test("let the neutral words of the contract through", async () => {
    const neutral = withProbe("export const ids = 'elementId bpmnProcessId definitionId c78';")
    expect(await rulesFiredOn(neutral)).toEqual([])
  })

  test("keep the engine CLI out of the extension outside its composition root", async () => {
    const host = "export const cli = 'engine-cli';\n"
    expect(await rulesFiredOn(host, "apps/vscode/src/host/engine-status-bar.ts")).toContain(
      "no-restricted-syntax",
    )
    expect(await rulesFiredOn(host, "apps/vscode/src/host/composition-root.ts")).not.toContain(
      "no-restricted-syntax",
    )
  })

  test.each([
    [
      "apps/vscode/src/webview/format/json-text.ts",
      "export const colour = 'var(--vscode-foreground)';\n",
    ],
  ])("keep VS Code colours out of the webview: %s", async (filePath, text) => {
    expect(await rulesFiredOn(text, filePath)).toEqual(["no-restricted-syntax"])
  })

  test.each([
    "export function helper(): number {\n  return 1;\n}",
    "function helper(): number {\n  return 1;\n}\nexport const one = helper();",
    "export const helper = (): number => 1;",
  ])("keep behaviour in classes: %s", async (line) => {
    const probe = `${readRepoFile(CLASS_PROBE)}\n${line}\n`
    expect(await rulesFiredOn(probe, CLASS_PROBE)).toContain("no-restricted-syntax")
  })

  test.each([
    [COMPONENT_PROBE, "function helper(): number {\n  return 1;\n}\nexport const one = helper();"],
    [COMPONENT_PROBE, "export const helper = (): number => 1;"],
    [
      "apps/vscode/src/webview/format/json-text.ts",
      "export function useProbe(): number {\n  return 1;\n}",
    ],
  ])("keep the helpers of components in classes: %s", async (filePath, line) => {
    const probe = `${readRepoFile(filePath)}\n${line}\n`
    expect(await rulesFiredOn(probe, filePath)).toContain("no-restricted-syntax")
  })

  test("let Preact components and hooks stay functions", async () => {
    const probe = `${readRepoFile(COMPONENT_PROBE)}\nexport function Probe() {\n  return null;\n}\n\nexport function useProbe(): number {\n  return 1;\n}\n`
    expect(await rulesFiredOn(probe, COMPONENT_PROBE)).toEqual([])
  })

  test("keep the webview's hooks in call order", async () => {
    const probe = `${readRepoFile(COMPONENT_PROBE)}\nexport function Probe({ on }: { on: boolean }) {\n  if (on) {\n    useProbe()\n  }\n  return null\n}\n\nexport function useProbe(): number {\n  return 1\n}\n`
    expect(await rulesFiredOn(probe, COMPONENT_PROBE)).toContain("react-hooks/rules-of-hooks")
  })

  test("allow one class per file", async () => {
    const probe = `${readRepoFile(CLASS_PROBE)}\nexport class Second {}\n`
    expect(await rulesFiredOn(probe, CLASS_PROBE)).toContain("max-classes-per-file")
  })

  test("declare what a class does before how it does it", async () => {
    const probe = `${readRepoFile(CLASS_PROBE)}\nexport class Ordered {\n  private how(): number {\n    return 1;\n  }\n\n  what(): number {\n    return this.how();\n  }\n}\n`
    expect(await rulesFiredOn(probe, "apps/vscode/src/contract/failing-runtime.ts")).toContain(
      "@typescript-eslint/member-ordering",
    )
  })

  test("let VS Code call activate and deactivate in the extension entry, nothing else", async () => {
    const entry = "apps/vscode/src/host/extension.ts"
    expect(await rulesFiredOn(readRepoFile(entry), entry)).toEqual([])
    const helper = `${readRepoFile(entry)}\nexport function helper(): number {\n  return 1;\n}\n`
    expect(await rulesFiredOn(helper, entry)).toEqual(["no-restricted-syntax"])
  })

  test.each([
    "apps/vscode/src/adapters/c7/mapping/timestamps.ts",
    "apps/vscode/src/adapters/c7/engine-rest/present.ts",
    "apps/vscode/src/host/notification-text.ts",
    "apps/vscode/src/host/connections/target-hosts.ts",
  ])("hold the adapters and the extension to the same class structure: %s", async (filePath) => {
    const probe = `${readRepoFile(filePath)}\nexport function helper(): number {\n  return 1;\n}\nexport class Second {}\n`
    expect(await rulesFiredOn(probe, filePath)).toEqual(
      expect.arrayContaining(["no-restricted-syntax", "max-classes-per-file"]),
    )
  })

  test("hold the webview test harness to the budgets and the non-null ban", async () => {
    const harness = "apps/vscode/test/webview/harness.tsx"
    expect(await rulesFiredOn(readRepoFile(harness), harness)).toEqual([])
    const statements = Array.from({ length: 21 }, (_, index) => `  void ${index}`)
    const probe = `${readRepoFile(harness)}\nexport const first = [1].at(0)!\n\nexport class Long {\n  run(): void {\n${statements.join("\n")}\n  }\n}\n`
    expect(await rulesFiredOn(probe, harness)).toEqual(
      expect.arrayContaining(["@typescript-eslint/no-non-null-assertion", "max-statements"]),
    )
  })

  test("hold the smoke test to the budgets", async () => {
    const smoke = "apps/vscode/test/smoke/activation.test.cjs"
    expect(await rulesFiredOn(readRepoFile(smoke), smoke)).toEqual([])
    const statements = Array.from({ length: 21 }, (_, index) => `  void ${index}`)
    const probe = `${readRepoFile(smoke)}\nmodule.exports.long = () => {\n${statements.join("\n")}\n}\n`
    expect(await rulesFiredOn(probe, smoke)).toEqual(["max-statements"])
  })

  test.each([
    ["export class Probe {\n  constructor() {}\n}", "@typescript-eslint/no-useless-constructor"],
    [
      "export const sum = (list) => {\n  let total = 0\n  for (let index = 0; index < list.length; index++) {\n    total += list[index]\n  }\n  return total\n}",
      "@typescript-eslint/prefer-for-of",
    ],
    [
      "export const drop = (record, key) => {\n  delete record[key]\n}",
      "@typescript-eslint/no-dynamic-delete",
    ],
    ["export const call = () => undeclared()", "no-undef"],
  ])("hold the JS files to the strict rules that need no types: %s", async (line, rule) => {
    const script = "apps/vscode/scripts/build.mjs"
    expect(await rulesFiredOn(readRepoFile(script), script)).toEqual([])
    expect(await rulesFiredOn(`${readRepoFile(script)}\n${line}\n`, script)).toContain(rule)
  })
})
