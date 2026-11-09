import * as vscode from "vscode"
import { LOCAL_TARGET, type EngineTarget } from "./engine-target.js"
import { TargetsFile } from "./targets-file.js"
import { TargetsParser } from "./targets-parser.js"
import { TargetsProblem } from "./targets-problem.js"

export interface DiscoveredTargets {
  readonly targets: readonly EngineTarget[]
  readonly problems: readonly TargetsProblem[]
}

export class TargetDiscovery {
  static async discover(): Promise<DiscoveredTargets> {
    const found = await vscode.workspace.findFiles(TargetsFile.GLOB, "**/node_modules/**")
    const targets: EngineTarget[] = []
    const problems: TargetsProblem[] = []
    for (const file of TargetsFile.current(found)) {
      const content = new TextDecoder().decode(await vscode.workspace.fs.readFile(file))
      const parsed = new TargetsParser(file.fsPath).parse(content)
      targets.push(
        ...parsed.targets.filter((target) => !targets.some((known) => known.name === target.name)),
      )
      problems.push(...parsed.problems)
    }
    const renames = TargetsFile.formerOnly(found).map(
      (file) => new TargetsProblem(file.fsPath, TargetsFile.RENAME),
    )
    problems.push(...renames)
    const fallback = targets.length === 0 && renames.length === 0
    return { targets: fallback ? [LOCAL_TARGET] : targets, problems }
  }
}
