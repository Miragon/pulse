import { useState } from "preact/hooks"

interface Pending<Value> {
  readonly from: Value
  readonly to: Value
}

export function usePendingValue<Value>(confirmed: Value): readonly [Value, (next: Value) => void] {
  const [pending, setPending] = useState<Pending<Value> | undefined>(undefined)
  const held = pending !== undefined && Object.is(pending.from, confirmed)
  if (pending !== undefined && !held) {
    setPending(undefined)
  }
  return [
    held ? pending.to : confirmed,
    (next) => {
      setPending({ from: confirmed, to: next })
    },
  ]
}
