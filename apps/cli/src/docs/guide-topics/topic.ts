/** A topic page of the agent guide, printed by `operate guide <name>` (design §19). */
export interface GuideTopic {
  /** The word of `operate guide <name>`: lowercase letters and dashes. */
  readonly name: string
  /** One line for the topic index of the core guide and `operate guide --list`. */
  readonly summary: string
  /** Markdown, formatted with Prettier: `# operate guide <name>: ...`, ending with one newline. */
  readonly text: string
}
