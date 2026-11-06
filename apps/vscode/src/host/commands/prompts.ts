export interface PromptInput {
  readonly title: string
  readonly prompt: string
  readonly value: string
  readonly password: boolean
  readonly validate: (value: string) => string | undefined
}

export interface PromptItem<T> {
  readonly label: string
  readonly item: T
  readonly description?: string
  readonly detail?: string
}

export interface Prompts {
  input(options: PromptInput): Promise<string | undefined>
  pick<T>(title: string, items: readonly PromptItem<T>[], question?: string): Promise<T | undefined>
}
