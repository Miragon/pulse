import type { Dialect } from "@miragon/pulse-profile"
import type { ProfileSourceKind } from "./profile-source.js"

interface ClientCredentialsAuth {
  readonly kind: "clientCredentials"
  readonly tokenEndpoint: string
  readonly clientId?: string
  readonly audience?: string
  readonly scopes?: readonly string[]
}

export type TargetAuth =
  | { readonly kind: "none" }
  | { readonly kind: "basic" }
  | { readonly kind: "oauth2" }
  | ClientCredentialsAuth

type TargetSource =
  { readonly kind: ProfileSourceKind; readonly path: string } | { readonly kind: "default" }

export interface EngineTarget {
  readonly name: string
  readonly engine: Dialect
  readonly endpoint: string
  readonly auth: TargetAuth
  readonly source: TargetSource
  readonly webUiUrl?: string
  readonly readOnly?: true
  readonly timeoutMs?: number
}
