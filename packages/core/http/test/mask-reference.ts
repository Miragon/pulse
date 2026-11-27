/**
 * The masking as it was up to 0.34, kept as the reference the linear one in src/mask.ts is held
 * to (mask-linear.test.ts): plain to read, but it compiled a pattern per form for every string
 * literal and every number, so an error answer of a million literals took seconds (#691, F34).
 * Never shipped, it is what "the same result" means: it changes with the masking rule only, never
 * to let the linear one pass.
 */

const MASK = "***"
const SPECIAL = /[.*+?^${}()|[\]\\]/g

function patternOf(form: string): RegExp {
  const parts = form.split(/\s+/).map((part) => part.replace(SPECIAL, "\\$&"))
  return new RegExp(parts.join("\\s+"), "g")
}

export function referenceMaskSecrets(text: string, forms: readonly string[]): string {
  let masked = text
  for (const form of forms) masked = masked.replace(patternOf(form), MASK)
  return masked
}

function literalEnd(text: string, start: number): number {
  for (let at = start + 1; at < text.length; at += 1) {
    const char = text[at]
    if (char === "\\") at += 1
    else if (char === '"') return at
  }
  return -1
}

function maskedLiteral(literal: string, forms: readonly string[]): string {
  let value: string
  try {
    value = JSON.parse(literal) as string
  } catch {
    return referenceMaskSecrets(literal, forms)
  }
  const masked = referenceMaskSecrets(value, forms)
  return masked === value ? literal : JSON.stringify(masked)
}

const NUMBER = /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g

function maskedNumbers(text: string, forms: readonly string[]): string {
  return text.replace(NUMBER, (number) =>
    forms.some((form) => patternOf(form).test(number)) ? JSON.stringify(MASK) : number,
  )
}

function finished(masked: string, forms: readonly string[]): string {
  return forms.some((form) => patternOf(form).test(masked))
    ? referenceMaskSecrets(masked, forms)
    : masked
}

export function referenceMaskJsonText(text: string, forms: readonly string[]): string {
  if (forms.length === 0) return text
  let masked = ""
  let at = 0
  for (let start = text.indexOf('"'); start !== -1; start = text.indexOf('"', at)) {
    const end = literalEnd(text, start)
    if (end === -1) return finished(masked + text.slice(at), forms)
    const literal = maskedLiteral(text.slice(start, end + 1), forms)
    masked += maskedNumbers(text.slice(at, start), forms) + literal
    at = end + 1
  }
  return finished(masked + maskedNumbers(text.slice(at), forms), forms)
}
