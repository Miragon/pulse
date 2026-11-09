type Scoped = Readonly<Record<string, unknown>>

export interface EnvironmentSettings {
  readonly user: Scoped | undefined
  readonly workspace: readonly (Scoped | undefined)[]
}
