import { MoveReasons, RuntimeError, type TokenMove } from "../../../contract/index.js"
import type { SourceTokenRef } from "./source-token.js"

export class MoveBody {
  static checked(move: TokenMove): void {
    const invalidReason = MoveReasons.whyInvalid(move.reason)
    if (invalidReason !== undefined) {
      throw new RuntimeError("rejected", invalidReason)
    }
  }

  static of(move: TokenMove, source: SourceTokenRef): string {
    return JSON.stringify({
      annotation: move.reason.trim(),
      instructions: [
        { type: "startBeforeActivity", activityId: move.toElementId },
        { type: "cancel", [source.field]: source.id },
      ],
    })
  }
}
