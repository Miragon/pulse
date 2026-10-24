const MOVES: Readonly<Record<string, (index: number, length: number) => number>> = {
  ArrowRight: (index, length) => (index + 1) % length,
  ArrowLeft: (index, length) => (index - 1 + length) % length,
  Home: () => 0,
  End: (_index, length) => length - 1,
}

export class RovingKeys {
  static move<Id extends string>(
    event: KeyboardEvent,
    ids: readonly Id[],
    select: (id: Id) => void,
  ): void {
    const move = MOVES[event.key]
    const focused = ids.findIndex((id) => id === (event.target as HTMLElement).dataset.key)
    const next = move === undefined ? undefined : ids[move(focused, ids.length)]
    if (next === undefined) {
      return
    }
    event.preventDefault()
    select(next)
    ;(event.currentTarget as HTMLElement)
      .querySelector<HTMLElement>(`[data-key="${next}"]`)
      ?.focus()
  }
}
