import { useEffect, useState } from "react"

const CONFIRMATION_MS = 1500

export function useCopied(): readonly [boolean, () => void] {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) {
      return undefined
    }
    const timer = window.setTimeout(() => {
      setCopied(false)
    }, CONFIRMATION_MS)
    return () => {
      window.clearTimeout(timer)
    }
  }, [copied])

  return [
    copied,
    () => {
      setCopied(true)
    },
  ]
}
