import { formatCount } from "@miragon/pulse-ui"
import type { WaitKindCode, WaitRowData } from "@miragon/pulse-screens"
import type { ComponentType, ReactNode } from "react"
import { useInstanceWords, type InstanceWords } from "../../messages/instance-words.js"
import type { InstanceSlots } from "../slots.js"
import { CalledInstanceLink } from "./called-instance-link.js"
import { InstanceTime, NoValue } from "./instance-time.js"

/** The props of the surface's way from a wait to its element on the diagram. */
export interface ElementLinkProps {
  readonly elementId: string
  /** The element's name, which the link says. */
  readonly children: ReactNode
}

export interface WaitingTableProps {
  /** The engine the instance runs on, as the surface names it. */
  readonly engine: string
  /** Where the instance and the instances it called wait (`InstanceScreenData.waits`). */
  readonly waits: readonly WaitRowData[]
  /** An element's name, as the surface knows it, where a row names none. */
  readonly nameOf: (elementId: string) => string
  /**
   * The surface's way from a wait of this instance to its element on the diagram, where a token
   * moves from it (a write slot: the editors that move tokens fill it); without it the element is
   * text.
   */
  readonly ElementLink?: ComponentType<ElementLinkProps>
  readonly slots: Pick<InstanceSlots, "PlainTable" | "Link">
}

const DETAILS: Readonly<
  Record<WaitKindCode, (t: InstanceWords, wait: WaitRowData) => string | undefined>
> = {
  userTask: (t, { assignee }) =>
    assignee === undefined ? t("wait.unassigned") : t("wait.assignedTo", { assignee }),
  workerTask: (t, { taskType }) => t("wait.taskType", { taskType: taskType ?? "" }),
  asyncContinuation: (t, { retriesLeft }) =>
    retriesLeft === undefined
      ? undefined
      : t("wait.retriesLeft", { count: formatCount(retriesLeft) }),
  message: (_t, { messageName }) => messageName,
  signal: (_t, { signalName }) => signalName,
  other: (_t, { description }) => description,
  timer: () => undefined,
}

function ElementCell({
  engine,
  row,
  nameOf,
  ElementLink,
  Link,
}: Pick<WaitingTableProps, "engine" | "nameOf" | "ElementLink"> & {
  readonly row: WaitRowData
  readonly Link: InstanceSlots["Link"]
}) {
  const t = useInstanceWords()
  const { liesIn } = row
  if (liesIn === null) {
    const name = row.elementName ?? nameOf(row.elementId)
    return ElementLink === undefined ? (
      <span>{name}</span>
    ) : (
      <ElementLink elementId={row.elementId}>{name}</ElementLink>
    )
  }
  return (
    <span className="inline-flex min-w-0 items-baseline gap-1 whitespace-nowrap">
      <span className="truncate">{row.elementName ?? row.elementId}</span>
      <span className="text-muted-foreground">
        {t("waiting.in")} <CalledInstanceLink engine={engine} called={liesIn} Link={Link} />
      </span>
    </span>
  )
}

/**
 * Where an instance waits, in the surface's table: the element (in an instance it called, that
 * instance's link beside it), the kind of wait, what the engine says of it (who it is assigned
 * to, the worker's task type, the retries left, the message or signal), since when and when it is
 * due. Its rows open nothing.
 */
export function WaitingTable({ engine, waits, nameOf, ElementLink, slots }: WaitingTableProps) {
  const t = useInstanceWords()
  const { PlainTable, Link } = slots
  return (
    <PlainTable<WaitRowData>
      name="waiting"
      label={t("waiting.label")}
      columns={[
        {
          key: "element",
          label: t("waiting.element"),
          cell: (row) => (
            <ElementCell
              engine={engine}
              row={row}
              nameOf={nameOf}
              {...(ElementLink === undefined ? {} : { ElementLink })}
              Link={Link}
            />
          ),
        },
        { key: "kind", label: t("waiting.kind"), cell: (row) => t(`wait.${row.kind}`) },
        {
          key: "detail",
          label: t("waiting.detail"),
          cell: (row) => DETAILS[row.kind](t, row) ?? <NoValue />,
        },
        {
          key: "since",
          label: t("waiting.since"),
          cell: (row) => <InstanceTime iso={row.since} />,
        },
        { key: "due", label: t("waiting.due"), cell: (row) => <InstanceTime iso={row.dueAt} /> },
      ]}
      rows={waits}
      rowKey={(row) => `${row.liesIn?.instanceId ?? ""}:${row.elementId}:${row.since ?? ""}`}
      empty={t("waiting.empty")}
    />
  )
}
