export type SetupValues = Readonly<Record<string, string>>

export interface SetupChoice {
  readonly value: string
  readonly label: string
  readonly detail: string
}

export interface SetupField {
  readonly key: string
  readonly title: string
  readonly prompt: string
  readonly choices?: readonly SetupChoice[]
  readonly password?: boolean
  readonly optional?: boolean
  readonly initial?: (values: SetupValues) => string
  readonly when?: (values: SetupValues) => boolean
  readonly problem?: (value: string, values: SetupValues) => string | undefined
}

export interface SetupCredentials {
  readonly identity: string
  readonly secret: string
}

export interface EngineSetup {
  readonly label: string
  readonly detail: string
  readonly title: string
  readonly fields: readonly SetupField[]
  suggestedName(values: SetupValues): string
  profileOf(values: SetupValues): Readonly<Record<string, unknown>>
  credentialsOf(values: SetupValues): SetupCredentials | undefined
}
