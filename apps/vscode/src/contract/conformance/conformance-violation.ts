export class ConformanceViolation extends Error {
  override readonly name = "ConformanceViolation"

  constructor(law: string, detail: string) {
    super(`${law}: ${detail}`)
  }
}
