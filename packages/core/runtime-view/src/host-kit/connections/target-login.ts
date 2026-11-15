import type { Credentials } from "./connection.js"
import { EditorAuth, type LoginFields, type Refused } from "./editor-auth.js"
import type { EngineTarget } from "./engine-target.js"
import { ProfileSource } from "./profile-source.js"
import { ProjectFile } from "./project-file.js"
import { TargetHosts } from "./target-hosts.js"
import { TargetPolicy } from "./target-policy.js"

export interface LoginAsk {
  readonly fields: LoginFields
  readonly sendsTo: string
}

const NO_CREDENTIALS: Credentials = { kind: "none" }

export class TargetLogin {
  static of(target: EngineTarget): LoginAsk | Refused {
    const refused = TargetPolicy.refusal(target, NO_CREDENTIALS)
    if (refused !== undefined) {
      return { refused }
    }
    const fields = EditorAuth.loginOf(target.auth)
    return fields === undefined
      ? { refused: TargetLogin.withoutLogin(target) }
      : { fields, sendsTo: TargetHosts.sendsTo(target) }
  }

  private static withoutLogin(target: EngineTarget): string {
    const types = EditorAuth.signingInWith(target.engine)
    const { source } = target
    if (source.kind === "default") {
      return `${target.name} has no profile, so Pulse sends no login. Add a profile with auth.type ${types} to ${ProjectFile.NAME} or your CLI config.`
    }
    const file = ProfileSource.of(source.kind).inSentence(source.path)
    return `The profile ${target.name} uses auth.type none, so Pulse sends no login. Set its auth.type to ${types} in ${file}.`
  }
}
