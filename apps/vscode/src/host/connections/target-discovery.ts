import * as vscode from "vscode"
import type { EngineCatalogue } from "./engine-catalogue.js"
import type { EngineTarget } from "./engine-target.js"
import { TargetsFile } from "./targets-file.js"
import { TargetsParser } from "./targets-parser.js"
import type { TargetsProblem } from "./targets-problem.js"

export interface DiscoveredTargets {
  readonly targets: readonly EngineTarget[]
  readonly problems: readonly TargetsProblem[]
}

export class TargetDiscovery {
  static async discover(catalogue: EngineCatalogue): Promise<DiscoveredTargets> {
    const found = await vscode.workspace.findFiles(TargetsFile.GLOB, "**/node_modules/**")
    const targets: EngineTarget[] = []
    const problems: TargetsProblem[] = []
    for (const file of found) {
      const content = new TextDecoder().decode(await vscode.workspace.fs.readFile(file))
      const parsed = new TargetsParser(file.fsPath, catalogue).parse(content)
      targets.push(
        ...parsed.targets.filter((target) => !targets.some((known) => known.name === target.name)),
      )
      problems.push(...parsed.problems)
    }
    const local = catalogue.localTarget()
    return { targets: targets.length > 0 || local === undefined ? targets : [local], problems }
  }
}
