import {
  describeProblem,
  dialectOf,
  parseProfileFile,
  type Problem,
  type Profile,
  type ProblemCode,
  type ProfileVerdict,
  refusalsOn,
  type Surface,
} from "@miragon/pulse-profile"
import { EditorAuth } from "./editor-auth.js"
import type { EngineTarget } from "./engine-target.js"
import { ProfileSource } from "./profile-source.js"
import { TargetsProblem } from "./targets-problem.js"

export interface ParsedTargets {
  readonly names: readonly string[]
  readonly targets: readonly EngineTarget[]
  readonly problems: readonly TargetsProblem[]
}

const SURFACE: Surface = {
  dialects: EditorAuth.DIALECTS,
  authTypes: EditorAuth.AUTH_TYPES,
  urlRequired: true,
  defaultEngineOnly: true,
  refusedKeys: ["headers"],
}

const AUTH_KEY_CODES: ReadonlySet<ProblemCode> = new Set([
  "auth-type-unknown",
  "auth-keys-mixed",
  "auth-type-mismatch",
  "auth-type-not-in-dialect",
])

export class TargetsParser {
  constructor(
    private readonly path: string,
    private readonly source: ProfileSource = ProfileSource.PROJECT,
  ) {}

  parse(content: string): ParsedTargets {
    const file = parseProfileFile(content, { credentials: this.source.credentials })
    if (file.problem !== undefined) {
      return { names: [], targets: [], problems: [this.problem(describeProblem(file.problem))] }
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
    const names = file.profiles.flatMap(({ name }) => (name === undefined ? [] : [name]))
    return { names, targets, problems }
  }

  private targetOf(verdict: ProfileVerdict): EngineTarget | TargetsProblem {
    const { name, profile } = verdict
    if (profile === undefined || name === undefined) {
      return this.refusal(verdict, verdict.problems)
    }
    const refusals = refusalsOn(profile, SURFACE)
    if (refusals.length > 0 || profile.url === undefined) {
      return this.refusal(verdict, refusals)
    }
    const auth = EditorAuth.of(profile)
    if ("refused" in auth) {
      return this.problem(`${TargetsParser.subjectOf(verdict)}: ${auth.refused}`)
    }
    return {
      name,
      engine: dialectOf(profile),
      endpoint: profile.url,
      auth,
      source: { kind: this.source.kind, path: this.path },
      ...this.optionalsOf(profile),
    }
  }

  private optionalsOf(profile: Profile): Pick<EngineTarget, "webUiUrl" | "readOnly" | "timeoutMs"> {
    return {
      ...(profile.cockpitUrl === undefined ? {} : { webUiUrl: profile.cockpitUrl }),
      ...(profile.readOnly === true ? { readOnly: true } : {}),
      ...(profile.timeout === undefined ? {} : { timeoutMs: profile.timeout }),
    }
  }

  private refusal(verdict: ProfileVerdict, problems: readonly Problem[]): TargetsProblem {
    const sentences = problems.map((problem) => describeProblem(problem))
    const waysOut = problems.flatMap((problem) => this.wayOut(problem, verdict.profile) ?? [])
    return this.problem(
      `${TargetsParser.subjectOf(verdict)}: ${[...sentences, ...new Set(waysOut)].join(" ")}`,
    )
  }

  private wayOut(problem: Problem, profile: Profile | undefined): string | undefined {
    const { code, key } = problem
    if (AUTH_KEY_CODES.has(code) || (code === "invalid" && key === "auth.type")) {
      return EditorAuth.authKeysWayOut()
    }
    if (profile === undefined) {
      return undefined
    }
    if (code === "key-not-served") {
      return key === "headers" ? EditorAuth.headersWayOut(profile, this.source) : undefined
    }
    return code === "auth-type-not-served"
      ? EditorAuth.authTypeWayOut(profile, this.source)
      : undefined
  }

  private problem(message: string, severity?: "warning"): TargetsProblem {
    return new TargetsProblem(this.path, message, severity, this.source)
  }

  private static subjectOf(verdict: ProfileVerdict): string {
    return verdict.name === undefined
      ? `profile ${String(verdict.index + 1)}`
      : `profile "${verdict.name}"`
  }
}
