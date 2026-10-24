/** A topic page of the agent guide, printed by `pulse-cli guide <name>`. */
export interface GuideTopic {
  /** The word of `pulse-cli guide <name>`: lowercase letters and dashes. */
  readonly name: string
  /** One line for the topic index of the core guide and `pulse-cli guide --list`. */
  readonly summary: string
  /** Markdown, formatted with Prettier: `# pulse-cli guide <name>: ...`, ending with one newline. */
  readonly text: string
}
