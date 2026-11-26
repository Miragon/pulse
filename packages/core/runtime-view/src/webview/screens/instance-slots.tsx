import type {
  InstanceSlots,
  ScreenLinkProps,
  ScreenLinkRel,
  ScreenPlainTableProps,
} from "@miragon/pulse-blocks"
import type { ComponentType } from "react"
import { DataTable } from "../components/data-table.js"
import { EmptyHint } from "../components/empty-hint.js"
import { useHost } from "../host/host-context.js"
import { CalledInstanceLink, type OpenLinkProps } from "./called-instance-link.js"
import { CallerLink, DefinitionLink } from "./instance-header.js"
import { ScreenIntents } from "./screen-intents.js"

const LINKS: Readonly<Record<ScreenLinkRel, ComponentType<OpenLinkProps>>> = {
  version: DefinitionLink,
  caller: CallerLink,
  called: CalledInstanceLink,
}

function PlainTable<Row>({
  name,
  label,
  columns,
  rows,
  rowKey,
  empty,
}: ScreenPlainTableProps<Row>) {
  return (
    <DataTable
      label={label}
      resizeId={name}
      columns={columns.map((column) => ({
        key: column.key,
        label: column.label,
        render: column.cell,
      }))}
      rows={rows}
      rowKey={rowKey}
      empty={<EmptyHint text={empty} />}
    />
  )
}

function Link({ rel, target, title, children }: ScreenLinkProps) {
  const host = useHost()
  const Shown = LINKS[rel]
  return (
    <Shown
      title={title}
      onOpen={(toSide) => {
        const intent = ScreenIntents.of(target, { toSide })
        if (intent !== undefined) {
          host.post(intent)
        }
      }}
    >
      {children}
    </Shown>
  )
}

export function useInstanceSlots(): InstanceSlots {
  const host = useHost()
  return {
    PlainTable,
    Link,
    onCopy: (copy) => {
      host.post({ type: "copy", text: copy.text, label: copy.label })
    },
  }
}
