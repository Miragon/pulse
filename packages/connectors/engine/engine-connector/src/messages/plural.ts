/** A count may arrive formatted ("1.234"), so "one" is decided on the text: exactly "1". */
export function isOne(count: unknown): boolean {
  return String(count) === "1"
}

export function countOf(count: unknown, one: string, other: string): string {
  return `${String(count)} ${isOne(count) ? one : other}`
}
