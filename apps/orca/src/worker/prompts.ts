import { randomUUID } from "node:crypto"
import type { Prompt, PromptAnswer } from "../protocol.js"

const EXPIRES_AFTER_MS = 10 * 60_000

type Draft = Prompt extends infer P ? (P extends Prompt ? Omit<P, "id"> : never) : never

interface Pending {
  readonly prompt: Prompt
  readonly settle: (answer: PromptAnswer | undefined) => void
}

export class Prompts {
  private readonly pending = new Map<string, Pending>()

  constructor(private readonly changed: (count: number) => void) {}

  ask(draft: Draft): Promise<PromptAnswer | undefined> {
    const id = randomUUID()
    const prompt = { ...draft, id } as Prompt
    return new Promise((resolve) => {
      const expiry = setTimeout(() => {
        this.settle(id, undefined)
      }, EXPIRES_AFTER_MS)
      this.pending.set(id, {
        prompt,
        settle: (answer) => {
          clearTimeout(expiry)
          resolve(answer)
        },
      })
      this.changed(this.pending.size)
    })
  }

  dispose(): void {
    for (const id of [...this.pending.keys()]) {
      this.settle(id, undefined)
    }
  }

  list(): readonly Prompt[] {
    return [...this.pending.values()].map((pending) => pending.prompt)
  }

  answer(id: string, answer: PromptAnswer): boolean {
    const pending = this.pending.get(id)
    if (pending?.prompt.kind !== answer.kind) {
      return false
    }
    this.settle(id, answer)
    return true
  }

  private settle(id: string, answer: PromptAnswer | undefined): void {
    const pending = this.pending.get(id)
    if (pending === undefined) {
      return
    }
    this.pending.delete(id)
    pending.settle(answer)
    this.changed(this.pending.size)
  }
}
