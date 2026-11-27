import { CopyableId, formatClock, formatInstant, shortId } from "@miragon/pulse-ui"
import type { CallerData, InstanceHeadData } from "@miragon/pulse-screens"
import { useInstanceWords } from "../../messages/instance-words.js"
import type { InstanceSlots } from "../slots.js"

/** What an instance's facts show of its head: its id, the version it runs, when it started or ended. */
export type InstanceFactsData = Pick<
  InstanceHeadData,
  "id" | "definition" | "businessKey" | "startedAt" | "endedAt"
>

export interface InstanceFactsProps {
  /** The engine the instance runs on, as the surface names it. */
  readonly engine: string
  readonly instance: InstanceFactsData
  /** The instance that called this one, if one did (`InstanceScreenData.caller`). */
  readonly caller: CallerData | null
  /**
   * The words of the caller's link where a surface's own code already names it (the editors' core,
   * "from 3e9d1c2b…"); without them the block names the caller by its business key where its read
   * found one, else by its short id.
   */
  readonly callerLabel?: string
  readonly slots: Pick<InstanceSlots, "Link" | "onCopy">
}

/** When the instance started, or ended, to the millisecond: it gives way first in a narrow bar. */
function Timing({ instance }: { readonly instance: InstanceFactsData }) {
  const t = useInstanceWords()
  const at = instance.endedAt ?? instance.startedAt
  if (at === undefined) {
    return null
  }
  const time = formatClock(at, { milliseconds: true })
  return (
    <span
      className="text-small text-muted-foreground tabular-nums max-[900px]:hidden"
      title={formatInstant(at)}
    >
      {instance.endedAt === undefined ? t("facts.started", { time }) : t("facts.ended", { time })}
    </span>
  )
}

/**
 * The facts of an instance's bar, beside its title: its id to copy where the title is its business
 * key, the process and version it runs (a link to that version), the instance that called it (a
 * link, by its business key where its read found one, else its short id) and when it started or
 * ended. The surface puts them in its bar, which brings the title and the actions.
 */
export function InstanceFacts({
  engine,
  instance,
  caller,
  callerLabel,
  slots,
}: InstanceFactsProps) {
  const t = useInstanceWords()
  const { Link, onCopy } = slots
  const { definition } = instance
  const process = definition.name ?? definition.bpmnProcessId
  const label = t("id.instance")
  return (
    <>
      {instance.businessKey !== undefined && (
        <CopyableId
          id={instance.id}
          label={label}
          onCopy={(id) => {
            onCopy({ text: id, label })
          }}
        />
      )}
      <Link
        rel="version"
        target={{
          kind: "version",
          engine,
          bpmnProcessId: definition.bpmnProcessId,
          ...(definition.tenantId === undefined ? {} : { tenantId: definition.tenantId }),
          version: definition.version,
          definitionId: definition.id,
        }}
        title={t("facts.versionTitle", { process, version: definition.version })}
      >
        {t("facts.version", { process, version: definition.version })}
      </Link>
      {caller !== null && (
        <Link
          rel="caller"
          target={{ kind: "instance", engine, instanceId: caller.instanceId }}
          title={t("facts.callerTitle", { id: caller.instanceId })}
        >
          {callerLabel ??
            t("facts.caller", {
              caller: caller.found?.businessKey ?? shortId(caller.instanceId),
            })}
        </Link>
      )}
      <Timing instance={instance} />
    </>
  )
}
