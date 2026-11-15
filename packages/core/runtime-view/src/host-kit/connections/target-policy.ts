import type { Credentials } from "./connection.js"
import { EditorAuth } from "./editor-auth.js"
import type { EngineTarget } from "./engine-target.js"
import { TargetHosts } from "./target-hosts.js"

export class TargetPolicy {
  static refusal(target: EngineTarget, credentials: Credentials): string | undefined {
    if (!EditorAuth.connectsWith(target.auth)) {
      return `Profile "${target.name}" uses auth.type oauth, which this client cannot authenticate with. ${EditorAuth.oauthWayOut(target.engine)}`
    }
    if (EditorAuth.loginOf(target.auth) === undefined) {
      return undefined
    }
    if (credentials.kind === "savedForAnotherEndpoint") {
      return `The endpoint of ${target.name} moved from ${credentials.savedFor} to ${TargetHosts.credentialOrigins(target)} since you saved its credentials. Check the change, then set the credentials again.`
    }
    return TargetPolicy.clearText(target)
  }

  private static clearText(target: EngineTarget): string | undefined {
    const { auth } = target
    if (auth.kind === "clientCredentials" && TargetHosts.inClearText(auth.tokenEndpoint)) {
      return `${target.name} would send its client secret over plain HTTP. Use an https token endpoint.`
    }
    if (!TargetHosts.inClearText(target.endpoint)) {
      return undefined
    }
    return auth.kind === "basic"
      ? `${target.name} would send basic credentials over plain HTTP. Use an https endpoint.`
      : `${target.name} would send its tokens over plain HTTP. Use an https endpoint.`
  }
}
