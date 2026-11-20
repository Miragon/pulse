import { shortId } from "@miragon/pulse-ui"
import type { CalledInstanceRefData } from "@miragon/pulse-screens"
import { useInstanceWords } from "../../messages/instance-words.js"
import type { InstanceSlots } from "../slots.js"

/** A link to an instance this one called, by its process and short id, through the surface's link. */
export function CalledInstanceLink({
  engine,
  called,
  Link,
}: {
  readonly engine: string
  readonly called: CalledInstanceRefData
  readonly Link: InstanceSlots["Link"]
}) {
  const t = useInstanceWords()
  return (
    <Link
      rel="called"
      target={{ kind: "instance", engine, instanceId: called.instanceId }}
      title={t("called.title", { id: called.instanceId })}
    >
      {called.bpmnProcessId ?? ""} <code className="font-mono">{shortId(called.instanceId)}</code>
    </Link>
  )
}
