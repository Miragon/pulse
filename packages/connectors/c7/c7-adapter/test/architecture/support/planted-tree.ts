import { execFileSync, spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { REPO_ROOT } from "./files.js"

interface Violation {
  readonly from: string
  readonly to: string
  readonly rule: { readonly name: string }
}

export class PlantedTree {
  private readonly roots: string[] = []

  constructor(
    private readonly packageDir: string,
    private readonly planted: Readonly<Record<string, string>>,
  ) {}

  violations(): string[] {
    const output = execFileSync(this.depcruise(), this.arguments("json"), {
      cwd: this.plant(),
      encoding: "utf8",
    })
    const result = JSON.parse(output) as { summary: { violations: Violation[] } }
    return result.summary.violations
      .map((violation) => `${violation.rule.name}: ${violation.from} -> ${violation.to}`)
      .sort()
  }

  report(): string {
    const { stdout } = spawnSync(this.depcruise(), this.arguments("err-long"), {
      cwd: this.plant(),
      encoding: "utf8",
    })
    return stdout.replace(/\s+/g, " ")
  }

  dispose(): void {
    for (const root of this.roots) rmSync(root, { recursive: true, force: true })
  }

  private plant(): string {
    const root = mkdtempSync(join(tmpdir(), "pulse-depcruise-"))
    this.roots.push(root)
    for (const [path, text] of Object.entries(this.planted)) {
      const file = join(root, this.packageDir, path)
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, text)
    }
    symlinkSync(
      join(REPO_ROOT, this.packageDir, "node_modules"),
      join(root, this.packageDir, "node_modules"),
      "dir",
    )
    return root
  }

  private arguments(outputType: string): string[] {
    return [
      `${this.packageDir}/src`,
      `${this.packageDir}/test`,
      "--config",
      join(REPO_ROOT, this.packageDir, ".dependency-cruiser.cjs"),
      "--output-type",
      outputType,
    ]
  }

  private depcruise(): string {
    return join(REPO_ROOT, "node_modules/.bin/depcruise")
  }
}
