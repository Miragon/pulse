import type { PromptInput, PromptItem, Prompts } from "../../../src/host/commands/prompts.js"

export interface Asked {
  readonly title: string
  readonly input?: PromptInput
  readonly items?: readonly string[]
  readonly details?: readonly (string | undefined)[]
  readonly question?: string
}

export class ScriptedPrompts implements Prompts {
  readonly asked: Asked[] = []

  private readonly answers: (string | undefined)[]

  constructor(answers: readonly (string | undefined)[]) {
    this.answers = [...answers]
  }

  input(options: PromptInput): Promise<string | undefined> {
    this.asked.push({ title: options.title, input: options })
    const answer = this.next()
    const problem = answer === undefined ? undefined : options.validate(answer)
    if (problem !== undefined) {
      throw new Error(`"${String(answer)}" fails ${options.title}: ${problem}`)
    }
    return Promise.resolve(answer)
  }

  pick<T>(
    title: string,
    items: readonly PromptItem<T>[],
    question?: string,
  ): Promise<T | undefined> {
    this.asked.push({
      title,
      items: items.map((item) => item.label),
      details: items.map((item) => item.detail),
      ...(question === undefined ? {} : { question }),
    })
    const answer = this.next()
    if (answer === undefined) {
      return Promise.resolve(undefined)
    }
    const chosen = items.find((item) => item.label === answer)
    if (chosen === undefined) {
      throw new Error(`${title} offers no "${answer}"`)
    }
    return Promise.resolve(chosen.item)
  }

  titles(): string[] {
    return this.asked.map((asked) => asked.title)
  }

  private next(): string | undefined {
    if (this.answers.length === 0) {
      throw new Error("the script has no answer left")
    }
    return this.answers.shift()
  }
}
