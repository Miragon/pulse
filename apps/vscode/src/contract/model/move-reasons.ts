const MAX_REASON_LENGTH = 500
const UNPRINTABLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u

export class MoveReasons {
  static whyInvalid(reason: string): string | undefined {
    const text = reason.trim()
    if (text === "") {
      return "Give a reason for the move."
    }
    if (text.length > MAX_REASON_LENGTH) {
      return `Keep the reason within ${MAX_REASON_LENGTH} characters.`
    }
    return UNPRINTABLE.test(text)
      ? "Write the reason on one line, without control characters."
      : undefined
  }
}
