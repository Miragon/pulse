import { parseJson } from "@miragon/pulse-http"

export class WireJson {
  static parse(text: string): unknown {
    return parseJson(text, "string")
  }
}
