import { clipText } from "@miragon/pulse-http"

export class EngineTexts {
  static cut(text: string): string {
    return clipText(text)
  }
}
