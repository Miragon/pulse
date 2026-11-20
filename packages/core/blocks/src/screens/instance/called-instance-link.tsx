import { shortId } from "@miragon/pulse-ui"
import type { CalledInstanceRefData } from "@miragon/pulse-screens"
import { useInstanceWords } from "../../messages/instance-words.js"
import type { InstanceSlots } from "../slots.js"

/**
 * A link to an instance this one called, by its process and short id, through the surface's link;
 * where it leads to a root incident the called instance holds (an incident card's), the target names
 * that incident too, which a surface with addresses opens in focus.
 */
export function CalledInstanceLink({
  engine,
  called,
  incidentId,
  Link,
}: {
  readonly engine: string
  readonly called: CalledInstanceRefData
  readonly incidentId?: string
  readonly Link: InstanceSlots["Link"]
}) {
  const t = useInstanceWords()
  return (
    <Link
      rel="called"
      target={{
        kind: "instance",
        engine,
        instanceId: called.instanceId,
        ...(incidentId === undefined ? {} : { incidentId }),
      }}
      title={t("called.title", { id: called.instanceId })}
    >
      {called.bpmnProcessId ?? ""} <code className="font-mono">{shortId(called.instanceId)}</code>
    </Link>
  )
}
