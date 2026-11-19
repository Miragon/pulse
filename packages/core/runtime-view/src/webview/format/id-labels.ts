import { shortId } from "@miragon/pulse-ui/format"

export class IdLabels {
  static short(id: string): string {
    return shortId(id)
  }
}
