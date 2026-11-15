import { isEngineId } from "@miragon/pulse-c7-core/runtime"
import { EngineRequestError } from "./http/engine-request-error.js"

const CONTROL_CHARACTERS = /\p{Cc}/u
const MAX_NAME_LENGTH = 255

export class RequestArguments {
  static identifier(value: string): string {
    if (!isEngineId(value)) {
      throw EngineRequestError.refused(`"${value}" as an identifier is not accepted`)
    }
    return value
  }

  static optionalIdentifier(value: string | undefined): string | undefined {
    return value === undefined ? undefined : RequestArguments.identifier(value)
  }

  static identifierList(values: readonly string[] | undefined): string | undefined {
    return values?.map((value) => RequestArguments.identifier(value)).join(",")
  }

  static segment(value: string): string {
    return encodeURIComponent(RequestArguments.identifier(value))
  }

  static variableName(value: string): string {
    if (value === "" || value.length > MAX_NAME_LENGTH || CONTROL_CHARACTERS.test(value)) {
      throw EngineRequestError.refused("The variable name is not accepted")
    }
    return encodeURIComponent(value)
  }
}
