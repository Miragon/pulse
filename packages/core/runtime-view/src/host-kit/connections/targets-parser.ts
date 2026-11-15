import {
  authTypeOf,
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
import type { EngineKind, EngineTarget } from "./engine-target.js"
import { ProfileSource } from "./profile-source.js"
import { TargetsProblem } from "./targets-problem.js"

export interface ParsedTargets {
  readonly names: readonly string[]
  readonly targets: readonly EngineTarget[]
  readonly problems: readonly TargetsProblem[]
}

const DIALECTS: readonly EngineKind[] = ["c7"]

const SURFACE: Surface = {
  dialects: DIALECTS,
  authTypes: ["none", "basic", "oauth"],
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
    const refusals = profile === undefined ? verdict.problems : refusalsOn(profile, SURFACE)
    const auth = profile === undefined ? undefined : EditorAuth.kindOf(authTypeOf(profile))
    const engine = profile === undefined ? undefined : this.engineOf(profile)
    if (
      refusals.length > 0 ||
      name === undefined ||
      profile?.url === undefined ||
      auth === undefined ||
      engine === undefined
    ) {
      return this.refusal(verdict, refusals)
    }
    return {
      name,
      engine,
      endpoint: profile.url,
      auth,
      source: { kind: this.source.kind, path: this.path },
      ...this.optionalsOf(profile),
    }
  }

  private engineOf(profile: Profile): EngineKind | undefined {
    return DIALECTS.find((dialect) => dialect === dialectOf(profile))
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
    const sentences = problems.map((problem) => describeProblem(problem))
    const waysOut = problems.flatMap((problem) => this.wayOut(problem, verdict.profile) ?? [])
    return this.problem(`${subject}: ${[...sentences, ...new Set(waysOut)].join(" ")}`)
  }

  private wayOut(problem: Problem, profile: Profile | undefined): string | undefined {
    const { code, key } = problem
    if (AUTH_KEY_CODES.has(code) || (code === "invalid" && key === "auth.type")) {
      return EditorAuth.WAYS_OUT.authKeys
    }
    if (code === "key-not-served") {
      return key === "headers" ? this.headersWayOut() : undefined
    }
    return code === "auth-type-not-served" ? this.authTypeWayOut(profile) : undefined
  }

  private headersWayOut(): string {
    return this.source.isUserConfig()
      ? EditorAuth.WAYS_OUT.headersOfTheCli
      : EditorAuth.WAYS_OUT.headers
  }

  private authTypeWayOut(profile: Profile | undefined): string | undefined {
    if (profile === undefined || this.engineOf(profile) === undefined) {
      return undefined
    }
    if (authTypeOf(profile) !== "passthrough") {
      return EditorAuth.WAYS_OUT.authType
    }
    return this.source.isUserConfig()
      ? EditorAuth.WAYS_OUT.setAuthType
      : EditorAuth.WAYS_OUT.passthrough
  }

  private problem(message: string, severity?: "warning"): TargetsProblem {
    return new TargetsProblem(this.path, message, severity, this.source)
  }
}
