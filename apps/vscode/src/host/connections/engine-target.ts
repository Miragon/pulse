export type EngineKind = 'c7';

export type TargetAuth =
  { readonly kind: 'none' } | { readonly kind: 'basic' } | { readonly kind: 'oauth2' };

type TargetSource = { readonly kind: 'file'; readonly path: string } | { readonly kind: 'default' };

export interface EngineTarget {
  readonly name: string;
  readonly engine: EngineKind;
  readonly endpoint: string;
  readonly auth: TargetAuth;
  readonly source: TargetSource;
  readonly webUiUrl?: string;
  readonly readOnly?: true;
}

export const LOCAL_TARGET: EngineTarget = {
  name: 'local',
  engine: 'c7',
  endpoint: 'http://localhost:8080/engine-rest',
  auth: { kind: 'none' },
  source: { kind: 'default' },
};
