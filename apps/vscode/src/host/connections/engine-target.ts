export type TargetAuth =
  | { readonly kind: "none" }
  | { readonly kind: "basic" }
  | { readonly kind: "oauth2" }
  | {
      readonly kind: "clientCredentials"
      readonly tokenEndpoint: string
      readonly audience?: string
      readonly scopes?: readonly string[]
    }

type TargetSource = { readonly kind: "file"; readonly path: string } | { readonly kind: "default" }

export interface EngineTarget {
  readonly name: string
  readonly engine: string
  readonly endpoint: string
  readonly auth: TargetAuth
  readonly source: TargetSource
  readonly webUiUrl?: string
  readonly readOnly?: true
}
