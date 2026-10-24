import type { EngineTarget, TargetAuth } from "./engine-target.js"
import { TargetsProblem } from "./targets-problem.js"

export interface ParsedTargets {
  readonly targets: readonly EngineTarget[]
  readonly problems: readonly TargetsProblem[]
}

type Json = Readonly<Record<string, unknown>>

type Optionals = Pick<EngineTarget, "webUiUrl" | "readOnly">

const C7_FLAVORS: ReadonlySet<string> = new Set(["camunda7", "operaton", "cibseven"])
const DEFAULT_ENGINE = "default"
const WEB_PROTOCOLS: ReadonlySet<string> = new Set(["http:", "https:"])

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
    if (!this.isRecord(document) || !this.isRecord(document.profiles)) {
      return 'the file needs a "profiles" object'
    }
    return document.profiles
  }

  private targetOf(name: string, profile: unknown): EngineTarget | string {
    if (!this.isRecord(profile)) {
      return `profile "${name}" is not an object`
    }
    const unsupported = this.unsupportedEngineOf(name, profile)
    if (unsupported !== undefined) {
      return unsupported
    }
    const endpoint = this.text(profile, "url")
    const auth = this.authOf(profile)
    if (endpoint === undefined || !this.isUrlWithoutSecrets(endpoint) || auth === undefined) {
      return `profile "${name}" needs a valid url without credentials and an auth type Pulse supports (none, basic or oauth)`
    }
    const optional = this.optionalsOf(profile, name)
    if (typeof optional === "string") {
      return optional
    }
    return {
      name,
      engine: "c7",
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
    const flavor = this.text(profile, "flavor") ?? "camunda7"
    if (!C7_FLAVORS.has(flavor)) {
      return `profile "${name}" uses the flavor ${flavor}, which Pulse does not support yet`
    }
    if ((this.text(profile, "engine") ?? DEFAULT_ENGINE) !== DEFAULT_ENGINE) {
      return `profile "${name}" names a process engine other than "default", which Pulse does not support yet`
    }
    return undefined
  }

  private optionalsOf(profile: Json, name: string): Optionals | string {
    const webUiUrl = this.text(profile, "cockpitUrl")
    if (webUiUrl !== undefined && !this.isWebUrlWithoutSecrets(webUiUrl)) {
      return `profile "${name}" needs a cockpitUrl that is an http or https URL without credentials`
    }
    return {
      ...(webUiUrl === undefined ? {} : { webUiUrl }),
      ...(profile.readOnly === true ? { readOnly: true } : {}),
    }
  }

  private authOf(record: Json): TargetAuth | undefined {
    const auth = record.auth
    if (auth === undefined) {
      return { kind: "none" }
    }
    if (!this.isRecord(auth)) {
      return undefined
    }
    const kind = this.text(auth, "type")
    if (kind === "none" || kind === "basic") {
      return { kind }
    }
    return kind === "oauth" ? { kind: "oauth2" } : undefined
  }

  private isUrlWithoutSecrets(value: string): boolean {
    if (!URL.canParse(value)) {
      return false
    }
    const url = new URL(value)
    return url.username === "" && url.password === ""
  }

  private isWebUrlWithoutSecrets(value: string): boolean {
    return this.isUrlWithoutSecrets(value) && WEB_PROTOCOLS.has(new URL(value).protocol)
  }

  private text(record: Json, key: string): string | undefined {
    const value = record[key]
    return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined
  }

  private isRecord(value: unknown): value is Json {
    return typeof value === "object" && value !== null && !Array.isArray(value)
  }
}
