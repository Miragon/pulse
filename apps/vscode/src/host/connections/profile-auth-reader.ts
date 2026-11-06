import type { TargetAuth } from "./engine-target.js"
import { ProfileUrl } from "./profile-url.js"

type Json = Readonly<Record<string, unknown>>

const KINDS: ReadonlyMap<unknown, TargetAuth> = new Map<unknown, TargetAuth>([
  ["none", { kind: "none" }],
  ["basic", { kind: "basic" }],
  ["oauth", { kind: "oauth2" }],
])
const CLIENT_CREDENTIALS = "clientCredentials"
const SCOPE_TOKEN = /^[\x21\x23-\x5b\x5d-\x7e]+$/
const KEYS_NEEDING_A_TYPE = [
  "issuer",
  "authorizationEndpoint",
  "tokenEndpoint",
  "clientId",
  "clientSecret",
  "clientSecretEnv",
  "scopes",
  "audience",
  "redirectPort",
  "token",
  "tokenEnv",
]

export class ProfileAuthReader {
  static of(name: string, auth: unknown): TargetAuth | string {
    if (auth === undefined) {
      return { kind: "none" }
    }
    if (typeof auth !== "object" || auth === null || Array.isArray(auth)) {
      return ProfileAuthReader.unsupported(name)
    }
    const record = auth as Json
    if (record.type === "bearer") {
      return `profile "${name}" uses bearer auth, which Pulse does not support yet`
    }
    if (record.type === CLIENT_CREDENTIALS) {
      return ProfileAuthReader.clientCredentials(name, record)
    }
    if (record.type === undefined) {
      return ProfileAuthReader.implied(name, record)
    }
    return KINDS.get(record.type) ?? ProfileAuthReader.unsupported(name)
  }

  private static clientCredentials(name: string, auth: Json): TargetAuth | string {
    const tokenEndpoint = ProfileUrl.of(auth.tokenEndpoint)
    if (tokenEndpoint === undefined) {
      return `profile "${name}" needs an auth.tokenEndpoint that is an http or https URL`
    }
    const { audience, scopes } = auth
    if (scopes !== undefined && !ProfileAuthReader.isScopeList(scopes)) {
      return `profile "${name}" needs auth.scopes as a list of distinct scopes, such as ["api://pulse/.default"]`
    }
    if (audience !== undefined && !ProfileAuthReader.isNotBlank(audience)) {
      return `profile "${name}" needs an auth.audience that is not blank`
    }
    return {
      kind: "clientCredentials",
      tokenEndpoint,
      ...(audience === undefined ? {} : { audience }),
      ...(scopes === undefined ? {} : { scopes }),
    }
  }

  private static isNotBlank(value: unknown): value is string {
    return typeof value === "string" && value.trim() !== ""
  }

  private static isScopeList(value: unknown): value is readonly string[] {
    return (
      Array.isArray(value) &&
      value.every((scope) => typeof scope === "string" && SCOPE_TOKEN.test(scope)) &&
      new Set(value).size === value.length
    )
  }

  private static implied(name: string, auth: Json): TargetAuth | string {
    if (KEYS_NEEDING_A_TYPE.some((key) => Object.hasOwn(auth, key))) {
      return ProfileAuthReader.unsupported(name)
    }
    return ProfileAuthReader.isNotBlank(auth.username) ? { kind: "basic" } : { kind: "none" }
  }

  private static unsupported(name: string): string {
    return `profile "${name}" needs an auth type Pulse supports (none, basic, oauth or clientCredentials)`
  }
}
