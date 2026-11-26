import type { CalledInstanceRefData } from "@miragon/pulse-screens"
import type { CalledInstanceLink } from "../protocol/index.js"
import { Labels } from "./labels.js"

export class CalledInstanceLinks {
  static of({ instanceId, bpmnProcessId }: CalledInstanceRefData): CalledInstanceLink {
    return { instanceId, shortId: Labels.shortId(instanceId), bpmnProcessId: bpmnProcessId ?? "" }
  }
}
