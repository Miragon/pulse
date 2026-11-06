import type { EngineTarget } from "./engine-target.js"
import { ProfileAuthReader } from "./profile-auth-reader.js"
import { ProfileUrl } from "./profile-url.js"
import { TargetsProblem } from "./targets-problem.js"

export interface ParsedTargets {
  readonly targets: readonly EngineTarget[]
  readonly problems: readonly TargetsProblem[]
}

type Json = Readonly<Record<string, unknown>>

type Optionals = Pick<EngineTarget, "webUiUrl" | "readOnly">

const C7_FLAVORS: ReadonlySet<unknown> = new Set(["camunda7", "operaton", "cibseven"])
const C8_FLAVOR = "camunda8"
const DEFAULT_ENGINE = "default"
const PROFILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const NOT_ENGINE_NAMES: ReadonlySet<string> = new Set(["", ".", ".."])
const NEEDS_PROFILES = 'the file needs a "profiles" object'
const PLAIN_URL = "an http or https URL without credentials, query or fragment"

export class TargetsParser {
  constructor(private readonly path: string) {}

  parse(content: string): ParsedTargets {
    const profiles = this.profilesOf(content)
    if (typeof profiles === "string") {
      return { targets: [], problems: [new TargetsProblem(this.path, profiles)] }
    }
    const targets: EngineTarget[] = []
    const problems: TargetsProblem[] = []
    for (const [name, profile] of Object.entries(profiles)) {
      const target = this.targetOf(name, profile)
      if (typeof target === "string") {
        problems.push(new TargetsProblem(this.path, target))
      } else {
        targets.push(target)
      }
    }
    return { targets, problems }
  }

  private profilesOf(content: string): Json | string {
    let document: unknown
    try {
      document = JSON.parse(content)
    } catch {
      return "the file is not valid JSON"
    }
    if (!this.isRecord(document)) {
      return NEEDS_PROFILES
    }
    if (document.profiles === undefined) {
      return {}
    }
    return this.isRecord(document.profiles) ? document.profiles : NEEDS_PROFILES
  }

  private targetOf(name: string, profile: unknown): EngineTarget | string {
    if (!PROFILE_NAME.test(name)) {
      return `profile "${name}" needs a name of letters, digits, ".", "_" and "-" that starts with a letter or digit`
    }
    if (!this.isRecord(profile)) {
      return `profile "${name}" is not an object`
    }
    const refusal = this.unsupportedEngineOf(name, profile) ?? this.readOnlyProblemOf(name, profile)
    if (refusal !== undefined) {
      return refusal
    }
    const endpoint = ProfileUrl.of(profile.url)
    if (endpoint === undefined) {
      return `profile "${name}" needs a url that is ${PLAIN_URL}`
    }
    return this.withAuthOf(name, profile, endpoint)
  }

  private withAuthOf(name: string, profile: Json, endpoint: string): EngineTarget | string {
    const auth = ProfileAuthReader.of(name, profile.auth)
    if (typeof auth === "string") {
      return auth
    }
    const optional = this.optionalsOf(profile, name)
    if (typeof optional === "string") {
      return optional
    }
    const engine = profile.flavor === C8_FLAVOR ? "c8" : "c7"
    if (auth.kind === "clientCredentials" && engine === "c7") {
      return `profile "${name}" uses client credentials, which Pulse supports for the flavor ${C8_FLAVOR} only`
    }
    return {
      name,
      engine,
      endpoint,
      auth,
      source: { kind: "file", path: this.path },
      ...optional,
    }
  }

  private unsupportedEngineOf(name: string, profile: Json): string | undefined {
    if (Object.hasOwn(profile, "platform")) {
      return `profile "${name}" uses the key platform, now called flavor`
    }
    return this.flavorProblemOf(name, profile.flavor) ?? this.engineProblemOf(name, profile.engine)
  }

  private flavorProblemOf(name: string, flavor: unknown): string | undefined {
    if (flavor === undefined || flavor === C8_FLAVOR || C7_FLAVORS.has(flavor)) {
      return undefined
    }
    const named = typeof flavor === "string" ? flavor.trim() : ""
    return named === "" || named === C8_FLAVOR || C7_FLAVORS.has(named)
      ? `profile "${name}" needs a flavor of camunda7, cibseven, operaton or ${C8_FLAVOR}`
      : `profile "${name}" uses the flavor ${named}, which Pulse does not support yet`
  }

  private engineProblemOf(name: string, engine: unknown): string | undefined {
    if (engine === undefined) {
      return undefined
    }
    const named = typeof engine === "string" ? engine.trim() : ""
    if (NOT_ENGINE_NAMES.has(named)) {
      return `profile "${name}" needs an engine name that is not blank, "." or ".."`
    }
    return named === DEFAULT_ENGINE
      ? undefined
      : `profile "${name}" names a process engine other than "default", which Pulse does not support yet`
  }

  private readOnlyProblemOf(name: string, profile: Json): string | undefined {
    const readOnly = profile.readOnly
    return readOnly === undefined || typeof readOnly === "boolean"
      ? undefined
      : `profile "${name}" needs readOnly true or false`
  }

  private optionalsOf(profile: Json, name: string): Optionals | string {
    const webUiUrl =
      profile.cockpitUrl === undefined ? undefined : ProfileUrl.of(profile.cockpitUrl)
    if (profile.cockpitUrl !== undefined && webUiUrl === undefined) {
      return `profile "${name}" needs a cockpitUrl that is ${PLAIN_URL}`
    }
    return {
      ...(webUiUrl === undefined ? {} : { webUiUrl }),
      ...(profile.readOnly === true ? { readOnly: true } : {}),
    }
  }

  private isRecord(value: unknown): value is Json {
    return typeof value === "object" && value !== null && !Array.isArray(value)
  }
}
