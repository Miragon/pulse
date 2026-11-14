import type { EngineTarget } from "./engine-target.js"
import { ProjectFile } from "./project-file.js"
import { type ParsedTargets, TargetsParser } from "./targets-parser.js"
import { TargetsProblem } from "./targets-problem.js"

type FileFailure = "missing" | "unreadable" | "former-name"

export type FileVerdict =
  | { readonly kind: "read"; readonly path: string; readonly text: string }
  | { readonly kind: FileFailure; readonly path: string }

export interface DiscoveredTargets {
  readonly targets: readonly EngineTarget[]
  readonly problems: readonly TargetsProblem[]
}

const BLOCKS_LOCAL: ReadonlySet<FileVerdict["kind"]> = new Set(["unreadable", "former-name"])

export class TargetMerge {
  static readonly UNREADABLE = "Pulse can't read this file"

  constructor(private readonly local: EngineTarget) {}

  merge(files: readonly FileVerdict[]): DiscoveredTargets {
    const parsed = files.map((file) => TargetMerge.parsed(file))
    const targets = TargetMerge.firstWins(parsed.flatMap((file) => file.targets))
    const blocked = files.some((file) => BLOCKS_LOCAL.has(file.kind))
    return {
      targets: targets.length === 0 && !blocked ? [this.local] : targets,
      problems: parsed.flatMap((file) => file.problems),
    }
  }

  private static parsed(file: FileVerdict): ParsedTargets {
    if (file.kind === "read") {
      return new TargetsParser(file.path).parse(file.text)
    }
    const message = file.kind === "former-name" ? ProjectFile.RENAME : TargetMerge.UNREADABLE
    return { targets: [], problems: [new TargetsProblem(file.path, message)] }
  }

  private static firstWins(targets: readonly EngineTarget[]): EngineTarget[] {
    return targets.filter(
      (target, index) => targets.findIndex((known) => known.name === target.name) === index,
    )
  }
}
