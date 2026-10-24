import { execFileSync } from "node:child_process"
import { join } from "node:path"
import { describe, expect, test } from "vitest"
import { REPO_ROOT } from "./support/files.js"

interface Violation {
  readonly from: string
  readonly to: string
  readonly rule: { readonly name: string }
}

function violationsIn(fixture: string): string[] {
  const output = execFileSync(
    join(REPO_ROOT, "node_modules/.bin/depcruise"),
    ["packages", "--config", join(REPO_ROOT, ".dependency-cruiser.cjs"), "--output-type", "json"],
    { cwd: join(REPO_ROOT, "test/architecture/fixtures", fixture), encoding: "utf8" },
  )
  const result = JSON.parse(output) as { summary: { violations: Violation[] } }
  return result.summary.violations.map(
    (violation) => `${violation.rule.name}: ${violation.from} -> ${violation.to}`,
  )
}

describe("the dependency rules", () => {
  test("fire on every planted violation and on nothing else", () => {
    expect(violationsIn("violations").sort()).toEqual(
      [
        "adapter-proven-on-an-engine: packages/adapter-other/src/index.ts -> packages/adapter-other/src/index.ts",
        "engine-test-runs-the-conformance-kit: packages/adapter-c7/test/c7.engine.test.ts -> packages/adapter-c7/test/c7.engine.test.ts",
        "model-libraries-stay-in-the-model-adapter: packages/extension/src/reads-model-library.ts -> ../../../../node_modules/bpmn-moddle/dist/index.js",
        "no-circular: packages/core/src/cycle-a.ts -> packages/core/src/cycle-b.ts",
        "no-undeclared-dependencies: packages/extension/src/reads-model-library.ts -> ../../../../node_modules/bpmn-moddle/dist/index.js",
        "not-in-allowed: packages/adapter-c7/src/mapping-uses-node.ts -> child_process",
        "not-in-allowed: packages/adapter-other/src/peer.ts -> packages/adapter-c7/src/index.ts",
        "not-in-allowed: packages/core/src/deep-contract.ts -> packages/contract/src/ids.ts",
        "not-in-allowed: packages/core/src/uses-node.ts -> fs",
        "not-in-allowed: packages/extension/src/not-the-root.ts -> packages/adapter-c7/src/index.ts",
        "not-in-allowed: packages/extension/src/reads-model-library.ts -> ../../../../node_modules/bpmn-moddle/dist/index.js",
        "not-in-allowed: packages/webview/src/runtime-import.ts -> packages/core/src/protocol/index.ts",
        "engine-cli-wrapper-is-self-contained: packages/adapter-c7/src/engine-cli/reaches-out.ts -> packages/contract/src/index.ts",
        "protocol-imports-nothing: packages/core/src/protocol/leaky.ts -> packages/contract/src/index.ts",
      ].sort(),
    )
  })
})
