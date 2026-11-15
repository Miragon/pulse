import type { EngineTarget } from "./engine-target.js"
import { ProfileSource } from "./profile-source.js"
import { ProjectFile } from "./project-file.js"
import { type ParsedTargets, TargetsParser } from "./targets-parser.js"
import { TargetsProblem } from "./targets-problem.js"
import { UserConfigLocation } from "./user-config-location.js"

type FileFailure = "missing" | "unreadable" | "former-name"

export type FileVerdict =
  | { readonly kind: "read"; readonly path: string; readonly text: string }
  | { readonly kind: FileFailure; readonly path: string }

export type UserConfigVerdict = Exclude<FileVerdict, { readonly kind: "former-name" }>

export interface UserConfigRead {
  readonly location: UserConfigLocation
  readonly verdict?: UserConfigVerdict
}

export interface DiscoveredTargets {
  readonly targets: readonly EngineTarget[]
  readonly problems: readonly TargetsProblem[]
}

const BLOCKS_LOCAL: ReadonlySet<FileVerdict["kind"]> = new Set(["unreadable", "former-name"])

const NOTHING: ParsedTargets = { names: [], targets: [], problems: [] }

const VARIABLE = UserConfigLocation.VARIABLE

export class TargetMerge {
  static readonly UNREADABLE = "Pulse can't read this file"

  static readonly RELATIVE = `${VARIABLE} names your CLI config by a relative path, and Pulse has no folder to resolve it from. Set the variable to the file's full path.`

  static readonly NAMED_MISSING = `${VARIABLE} names this file, which does not exist. Create it, or change the variable.`

  static readonly NAMED_ONLY = `${VARIABLE} names this file, so Pulse reads no ${ProjectFile.NAME}, like the CLI.`

  constructor(private readonly local: EngineTarget) {}

  merge(files: readonly FileVerdict[], user?: UserConfigRead): DiscoveredTargets {
    if (user?.location.explicit === true) {
      return this.named(user, files.length > 0)
    }
    const verdict = user?.verdict
    const projects = files.map((file) => TargetMerge.parsed(file, ProfileSource.PROJECT))
    const own = TargetMerge.ownOf(verdict)
    const verdicts = verdict === undefined ? files : [...files, verdict]
    return this.withLocal(
      TargetMerge.joined(projects, own),
      verdicts.some((file) => BLOCKS_LOCAL.has(file.kind)),
      [...projects, own].flatMap((file) => file.problems),
    )
  }

  private named(user: UserConfigRead, hidesProjectFiles: boolean): DiscoveredTargets {
    const { location, verdict } = user
    if (location.isRelative() || verdict === undefined) {
      return TargetMerge.failed(location.path, TargetMerge.RELATIVE)
    }
    if (verdict.kind !== "read") {
      const missing = verdict.kind === "missing"
      return TargetMerge.failed(
        verdict.path,
        missing ? TargetMerge.NAMED_MISSING : TargetMerge.UNREADABLE,
      )
    }
    const own = TargetMerge.parsed(verdict, ProfileSource.USER_CONFIG)
    const hidden = hidesProjectFiles
      ? [TargetMerge.ownProblem(verdict.path, TargetMerge.NAMED_ONLY, "warning")]
      : []
    return this.withLocal(own.targets, false, [...own.problems, ...hidden])
  }

  private withLocal(
    targets: readonly EngineTarget[],
    blocked: boolean,
    problems: readonly TargetsProblem[],
  ): DiscoveredTargets {
    return { targets: targets.length === 0 && !blocked ? [this.local] : targets, problems }
  }

  private static ownOf(verdict: UserConfigVerdict | undefined): ParsedTargets {
    return verdict === undefined || verdict.kind === "missing"
      ? NOTHING
      : TargetMerge.parsed(verdict, ProfileSource.USER_CONFIG)
  }

  private static failed(path: string, message: string): DiscoveredTargets {
    return { targets: [], problems: [TargetMerge.ownProblem(path, message)] }
  }

  private static ownProblem(path: string, message: string, severity?: "warning"): TargetsProblem {
    return new TargetsProblem(path, message, severity, ProfileSource.USER_CONFIG)
  }

  private static parsed(file: FileVerdict, source: ProfileSource): ParsedTargets {
    if (file.kind === "read") {
      return new TargetsParser(file.path, source).parse(file.text)
    }
    const message = file.kind === "former-name" ? ProjectFile.RENAME : TargetMerge.UNREADABLE
    return {
      names: [],
      targets: [],
      problems: [new TargetsProblem(file.path, message, undefined, source)],
    }
  }

  private static joined(projects: readonly ParsedTargets[], own: ParsedTargets): EngineTarget[] {
    const shared = TargetMerge.firstWins(projects.flatMap((file) => file.targets))
    const owned = new Set(own.names)
    const sharedNames = new Set(shared.map((target) => target.name))
    return [
      ...shared.flatMap((target) =>
        owned.has(target.name) ? own.targets.filter((mine) => mine.name === target.name) : [target],
      ),
      ...own.targets.filter((mine) => !sharedNames.has(mine.name)),
    ]
  }

  private static firstWins(targets: readonly EngineTarget[]): EngineTarget[] {
    return targets.filter(
      (target, index) => targets.findIndex((known) => known.name === target.name) === index,
    )
  }
}
