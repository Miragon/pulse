import { ProfileRules } from "../../contract/index.js"
import type { TargetAuth } from "./engine-target.js"
import { ProfileUrl } from "./profile-url.js"

type Json = Readonly<Record<string, unknown>>

const KINDS: ReadonlyMap<unknown, TargetAuth> = new Map<unknown, TargetAuth>([
  ["none", { kind: "none" }],
  ["basic", { kind: "basic" }],
  ["oauth", { kind: "oauth2" }],
])
const CLIENT_CREDENTIALS = "clientCredentials"
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
    const tokenEndpoint = ProfileUrl.asWritten(auth.tokenEndpoint)
    if ("needs" in tokenEndpoint) {
      return `profile "${name}" needs an auth.tokenEndpoint ${tokenEndpoint.needs}`
    }
    const { audience, scopes } = auth
    if (scopes !== undefined && !ProfileRules.isScopeList(scopes)) {
      return `profile "${name}" needs auth.scopes as a list of distinct scopes, such as ["api://pulse/.default"]`
    }
    if (audience !== undefined && !ProfileAuthReader.isNotBlank(audience)) {
      return `profile "${name}" needs an auth.audience that is not blank`
    }
    return {
      kind: "clientCredentials",
      tokenEndpoint: tokenEndpoint.url,
      ...(audience === undefined ? {} : { audience }),
      ...(scopes === undefined ? {} : { scopes }),
    }
  }

  private static isNotBlank(value: unknown): value is string {
    return typeof value === "string" && value.trim() !== ""
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
