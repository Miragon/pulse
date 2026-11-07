import type { TargetAuth } from "./engine-target.js"

type Json = Readonly<Record<string, unknown>>

const KINDS: ReadonlyMap<unknown, TargetAuth> = new Map<unknown, TargetAuth>([
  ["none", { kind: "none" }],
  ["basic", { kind: "basic" }],
  ["oauth", { kind: "oauth2" }],
])
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
    if (record.type === undefined) {
      return ProfileAuthReader.implied(name, record)
    }
    return KINDS.get(record.type) ?? ProfileAuthReader.unsupported(name)
  }

  private static implied(name: string, auth: Json): TargetAuth | string {
    if (KEYS_NEEDING_A_TYPE.some((key) => Object.hasOwn(auth, key))) {
      return ProfileAuthReader.unsupported(name)
    }
    const username = auth.username
    return typeof username === "string" && username.trim() !== ""
      ? { kind: "basic" }
      : { kind: "none" }
  }

  private static unsupported(name: string): string {
    return `profile "${name}" needs an auth type Pulse supports (none, basic or oauth)`
  }
}
