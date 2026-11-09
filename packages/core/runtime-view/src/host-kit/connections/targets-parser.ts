import {
  authTypeOf,
  describeProblem,
  dialectOf,
  parseProfileFile,
  type Problem,
  type Profile,
  type ProfileVerdict,
  refusalsOn,
  type Surface,
} from "@miragon/pulse-profile"
import type { EngineTarget, TargetAuth } from "./engine-target.js"
import { TargetsProblem } from "./targets-problem.js"

export interface ParsedTargets {
  readonly targets: readonly EngineTarget[]
  readonly problems: readonly TargetsProblem[]
}

const SURFACE: Surface = {
  dialects: ["c7"],
  authTypes: ["none", "basic", "oauth"],
  urlRequired: true,
  defaultEngineOnly: true,
  refusedKeys: ["headers"],
}

const AUTH_KINDS: Readonly<Record<string, TargetAuth>> = {
  none: { kind: "none" },
  basic: { kind: "basic" },
  oauth: { kind: "oauth2" },
}

export class TargetsParser {
  constructor(private readonly path: string) {}

  parse(content: string): ParsedTargets {
    const file = parseProfileFile(content, { credentials: "none" })
    if (file.problem !== undefined) {
      return { targets: [], problems: [this.problem(describeProblem(file.problem))] }
    }
    const targets: EngineTarget[] = []
    const problems = file.notes.map((note) => this.problem(describeProblem(note), "warning"))
    for (const verdict of file.profiles) {
      const target = this.targetOf(verdict)
      if (target instanceof TargetsProblem) {
        problems.push(target)
      } else {
        targets.push(target)
      }
    }
    return { targets, problems }
  }

  private targetOf(verdict: ProfileVerdict): EngineTarget | TargetsProblem {
    const { name, profile } = verdict
    const refusals = profile === undefined ? verdict.problems : refusalsOn(profile, SURFACE)
    const auth = profile === undefined ? undefined : AUTH_KINDS[authTypeOf(profile)]
    if (
      refusals.length > 0 ||
      name === undefined ||
      profile?.url === undefined ||
      auth === undefined
    ) {
      return this.refusal(verdict, refusals)
    }
    return {
      name,
      engine: dialectOf(profile),
      endpoint: profile.url,
      auth,
      source: { kind: "file", path: this.path },
      ...this.optionalsOf(profile),
    }
  }

  private optionalsOf(profile: Profile): Pick<EngineTarget, "webUiUrl" | "readOnly"> {
    return {
      ...(profile.cockpitUrl === undefined ? {} : { webUiUrl: profile.cockpitUrl }),
      ...(profile.readOnly === true ? { readOnly: true } : {}),
    }
  }

  private refusal(verdict: ProfileVerdict, problems: readonly Problem[]): TargetsProblem {
    const subject =
      verdict.name === undefined
        ? `profile ${String(verdict.index + 1)}`
        : `profile "${verdict.name}"`
    return this.problem(
      `${subject}: ${problems.map((problem) => describeProblem(problem)).join(" ")}`,
    )
  }

  private problem(message: string, severity?: "warning"): TargetsProblem {
    return new TargetsProblem(this.path, message, severity)
  }
}
