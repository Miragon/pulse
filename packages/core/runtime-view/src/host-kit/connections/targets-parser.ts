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
import type { EngineTarget, TargetAuth } from "./engine-target.js"
import { TargetPolicy } from "./target-policy.js"
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

const CONNECTING = new Intl.ListFormat("en", { type: "disjunction" }).format(
  SURFACE.authTypes.filter((type) => {
    const auth = AUTH_KINDS[type]
    return auth !== undefined && TargetPolicy.connectsWith(auth)
  }),
)

const WAYS_OUT = {
  authType: `Set auth.type to ${CONNECTING}, or keep this profile for the CLI.`,
  passthrough: `Set auth.type to ${CONNECTING}, or keep this profile for the MCP server.`,
  authKeys: `This client connects with auth.type ${CONNECTING}: use one of them.`,
  headers: "Remove headers from this profile, or use one without them.",
} as const

const AUTH_KEY_CODES: ReadonlySet<ProblemCode> = new Set([
  "auth-type-unknown",
  "auth-keys-mixed",
  "auth-type-mismatch",
])

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
    const sentences = problems.map((problem) => describeProblem(problem))
    const waysOut = problems.flatMap((problem) => this.wayOut(problem, verdict.profile) ?? [])
    return this.problem(`${subject}: ${[...sentences, ...new Set(waysOut)].join(" ")}`)
  }

  private wayOut(problem: Problem, profile: Profile | undefined): string | undefined {
    const { code, key } = problem
    if (AUTH_KEY_CODES.has(code) || (code === "invalid" && key === "auth.type")) {
      return WAYS_OUT.authKeys
    }
    if (code === "key-not-served") {
      return key === "headers" ? WAYS_OUT.headers : undefined
    }
    if (code !== "auth-type-not-served") {
      return undefined
    }
    return profile !== undefined && authTypeOf(profile) === "passthrough"
      ? WAYS_OUT.passthrough
      : WAYS_OUT.authType
  }

  private problem(message: string, severity?: "warning"): TargetsProblem {
    return new TargetsProblem(this.path, message, severity)
  }
}
