import type { Credentials } from "./connection.js"
import { EditorAuth } from "./editor-auth.js"
import type { EngineTarget } from "./engine-target.js"
import { TargetHosts } from "./target-hosts.js"

export class TargetPolicy {
  static refusal(target: EngineTarget, credentials: Credentials): string | undefined {
    if (!EditorAuth.connectsWith(target.auth)) {
      return `Profile "${target.name}" uses auth.type oauth, which this client cannot authenticate with. ${EditorAuth.WAYS_OUT.oauth}`
    }
    if (target.auth.kind === "basic" && credentials.kind === "savedForAnotherEndpoint") {
      return `The endpoint of ${target.name} changed since its credentials were saved for ${credentials.savedFor}. Set the credentials again to send them to the new endpoint.`
    }
    if (target.auth.kind === "basic" && TargetPolicy.sendsSecretsInClearText(target)) {
      return `${target.name} would send basic credentials over plain HTTP. Use an https endpoint.`
    }
    return undefined
  }

  private static sendsSecretsInClearText(target: EngineTarget): boolean {
    return new URL(target.endpoint).protocol === "http:" && !TargetHosts.isLoopback(target)
  }
}
