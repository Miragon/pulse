import { ESLint } from "eslint"
import { describe, expect, test } from "vitest"
import { readRepoFile, REPO_ROOT } from "./support/files.js"

const PROBE_FILE = "packages/core/runtime-view/src/core/views/labels.ts"
const ENGINE_CORE = "packages/connectors/engine/engine-core/src"
const CLASS_PROBE = `${ENGINE_CORE}/model/value-kinds.ts`
const COMPONENT_PROBE = "packages/core/runtime-view/src/webview/app.tsx"
const WEBVIEW_TEST_PROBE = "packages/core/runtime-view/test/webview/harness.tsx"
const HOOKS_SET = "recommended-latest"

interface ResolvedConfig {
  readonly rules: Readonly<Record<string, readonly unknown[] | undefined>>
  readonly plugins: {
    readonly "react-hooks": {
      readonly configs: Readonly<
        Record<string, { readonly rules: Readonly<Record<string, unknown>> }>
      >
    }
  }
}

const eslint = new ESLint({ cwd: REPO_ROOT })

async function rulesFiredOn(text: string, filePath = PROBE_FILE): Promise<string[]> {
  const [result] = await eslint.lintText(text, { filePath })
  return (result?.messages ?? []).map((message) => message.ruleId ?? message.message)
}

async function errorsFiredOn(text: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(text, { filePath })
  return (result?.messages ?? [])
    .filter((message) => message.severity === 2)
    .map((message) => message.ruleId ?? message.message)
}

async function hookSeverities(filePath: string): Promise<Record<string, unknown>> {
  const config = (await eslint.calculateConfigForFile(filePath)) as ResolvedConfig
  const set = Object.keys(config.plugins["react-hooks"].configs[HOOKS_SET]?.rules ?? {})
  return Object.fromEntries(set.map((rule) => [rule, config.rules[rule]?.[0]]))
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
    "export const flag = '--activity-id';",
    "export const column = `activity_id ${String(1)}`;",
  ])("keep engine words out of the core: %s", async (line) => {
    expect(await rulesFiredOn(withProbe(line))).toContain("no-restricted-syntax")
  })

  test.each([
    `${ENGINE_CORE}/ports/process-runtime.ts`,
    `${ENGINE_CORE}/model/ids.ts`,
    `${ENGINE_CORE}/testing/fake/fake-engine.ts`,
    "packages/core/runtime-view/src/ports/engine-adapter.ts",
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
    [PROBE_FILE, "export const share = (0.5).toFixed(1);"],
    [PROBE_FILE, "export const count = new Intl.NumberFormat('en').format(1);"],
    [PROBE_FILE, "export const ago = new Intl.RelativeTimeFormat('en').format(-1, 'day');"],
    [COMPONENT_PROBE, "export const at = new Date(0).toLocaleTimeString('en');"],
    [COMPONENT_PROBE, "export const day = new Intl.DateTimeFormat('en').format(new Date(0));"],
    [COMPONENT_PROBE, "export const total = (1234).toLocaleString();"],
  ])("format dates and numbers through the UI foundation only: %s", async (filePath, line) => {
    const probe = `${readRepoFile(filePath)}\n${line}\n`
    expect(await rulesFiredOn(probe, filePath)).toContain("no-restricted-syntax")
  })

  test.each([
    [
      "packages/core/runtime-view/src/webview/format/json-text.ts",
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
      "packages/core/runtime-view/src/webview/format/json-text.ts",
      "export function useProbe(): number {\n  return 1;\n}",
    ],
  ])("keep the helpers of components in classes: %s", async (filePath, line) => {
    const probe = `${readRepoFile(filePath)}\n${line}\n`
    expect(await rulesFiredOn(probe, filePath)).toContain("no-restricted-syntax")
  })

  test("let React components and hooks stay functions", async () => {
    const probe = `${readRepoFile(COMPONENT_PROBE)}\nexport function Probe() {\n  return null;\n}\n\nexport function useProbe(): number {\n  return 1;\n}\n`
    expect(await rulesFiredOn(probe, COMPONENT_PROBE)).toEqual([])
  })

  test("keep the webview's hooks in call order", async () => {
    const probe = `${readRepoFile(COMPONENT_PROBE)}\nexport function Probe({ on }: { on: boolean }) {\n  if (on) {\n    useProbe()\n  }\n  return null\n}\n\nexport function useProbe(): number {\n  return 1\n}\n`
    expect(await rulesFiredOn(probe, COMPONENT_PROBE)).toContain("react-hooks/rules-of-hooks")
  })

  test.each([
    [
      "react-hooks/set-state-in-effect",
      "export function Probe() {\n  const [shown, setShown] = useState(false)\n  useEffect(() => {\n    setShown(true)\n  }, [])\n  return shown ? null : null\n}",
    ],
    ["react-hooks/purity", "export function Probe() {\n  return <time>{Date.now()}</time>\n}"],
    [
      "react-hooks/immutability",
      "export function Probe({ seen }: { seen: { at: number } }) {\n  seen.at = 1\n  return <i>{seen.at}</i>\n}",
    ],
    [
      "react-hooks/refs",
      "export function Probe({ seenRef }: { seenRef: { current: number } }) {\n  return <i>{seenRef.current}</i>\n}",
    ],
    [
      "react-hooks/use-memo",
      "export function Probe({ rows }: { rows: string[] }) {\n  const joined = useMemo(() => rows.join(), [rows.join()])\n  return <i>{joined}</i>\n}",
    ],
    [
      "react-hooks/exhaustive-deps",
      "export function Probe({ rows }: { rows: string[] }) {\n  const joined = useMemo(() => rows.join(), [])\n  return <i>{joined}</i>\n}",
    ],
  ])("hold the webview to the hooks rule %s as an error", async (rule, component) => {
    const probe = `${readRepoFile(COMPONENT_PROBE)}\n${component}\n`
    expect(await errorsFiredOn(probe, COMPONENT_PROBE)).toContain(rule)
  })

  test.each([
    [COMPONENT_PROBE, 2],
    [WEBVIEW_TEST_PROBE, 2],
    [PROBE_FILE, 0],
  ])(
    `turn every rule of ${HOOKS_SET} on as an error in the webview and its tests only: %s`,
    async (filePath, severity) => {
      const severities = await hookSeverities(filePath)
      expect(Object.keys(severities)).toEqual(
        expect.arrayContaining(["react-hooks/refs", "react-hooks/exhaustive-deps"]),
      )
      expect(severities).toEqual(
        Object.fromEntries(Object.keys(severities).map((rule) => [rule, severity])),
      )
    },
  )

  test("allow one class per file", async () => {
    const probe = `${readRepoFile(CLASS_PROBE)}\nexport class Second {}\n`
    expect(await rulesFiredOn(probe, CLASS_PROBE)).toContain("max-classes-per-file")
  })

  test("declare what a class does before how it does it", async () => {
    const probe = `${readRepoFile(CLASS_PROBE)}\nexport class Ordered {\n  private how(): number {\n    return 1;\n  }\n\n  what(): number {\n    return this.how();\n  }\n}\n`
    expect(await rulesFiredOn(probe, `${ENGINE_CORE}/failing-runtime.ts`)).toContain(
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
    "packages/connectors/c7/c7-adapter/src/mapping/timestamps.ts",
    "packages/connectors/c7/c7-adapter/src/engine-rest/present.ts",
    "packages/core/runtime-view/src/host-kit/notification-text.ts",
    "packages/core/runtime-view/src/host-kit/connections/target-hosts.ts",
  ])("hold the adapters and the extension to the same class structure: %s", async (filePath) => {
    const probe = `${readRepoFile(filePath)}\nexport function helper(): number {\n  return 1;\n}\nexport class Second {}\n`
    expect(await rulesFiredOn(probe, filePath)).toEqual(
      expect.arrayContaining(["no-restricted-syntax", "max-classes-per-file"]),
    )
  })

  test("hold the webview test harness to the budgets and the non-null ban", async () => {
    const harness = "packages/core/runtime-view/test/webview/harness.tsx"
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
