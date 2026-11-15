import { maskSecrets, secretForms } from "@miragon/pulse-http"
import type { EngineCredentials } from "@miragon/pulse-runtime-view/ports"
import type { WireReason } from "./wire-reason.js"

export class SecretMask {
  static readonly NONE = new SecretMask([])

  private constructor(private readonly forms: readonly string[]) {}

  static of(credentials: EngineCredentials): SecretMask {
    return credentials.kind === "clientCredentials"
      ? new SecretMask(secretForms([credentials.clientSecret]))
      : SecretMask.NONE
  }

  text(text: string): string {
    return maskSecrets(text, this.forms)
  }

  reason(reason: WireReason): WireReason {
    switch (reason.kind) {
      case "token":
        return reason.code === undefined ? reason : { ...reason, code: this.text(reason.code) }
      case "answered":
        return {
          ...reason,
          message: this.text(reason.message),
          title: reason.title === undefined ? undefined : this.text(reason.title),
        }
      default:
        return { ...reason, message: this.text(reason.message) }
    }
  }
}
