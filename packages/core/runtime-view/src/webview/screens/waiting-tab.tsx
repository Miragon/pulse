import { WaitingTable, type ElementLinkProps } from "@miragon/pulse-blocks"
import { createContext, use, useMemo } from "react"
import type { WaitRow } from "../../core/protocol/index.js"
import { LinkButton } from "./called-instance-link.js"
import { InstanceForms } from "./instance-forms.js"
import { useInstanceSlots } from "./instance-slots.js"

export interface WaitingTabProps {
  readonly engine: string
  readonly waitStates: readonly WaitRow[]
  readonly elementName: (elementId: string) => string
  readonly onShowElement?: ((elementId: string) => void) | undefined
}

const ShowElement = createContext<(elementId: string) => void>(() => undefined)

function ShowOnDiagram({ elementId, children }: ElementLinkProps) {
  const show = use(ShowElement)
  return (
    <LinkButton
      title="Show on the diagram"
      onClick={() => {
        show(elementId)
      }}
    >
      {children}
    </LinkButton>
  )
}

export function WaitingTab({ engine, waitStates, elementName, onShowElement }: WaitingTabProps) {
  const slots = useInstanceSlots()
  const waits = useMemo(() => waitStates.map((row) => InstanceForms.wait(row)), [waitStates])
  if (onShowElement === undefined) {
    return <WaitingTable engine={engine} waits={waits} nameOf={elementName} slots={slots} />
  }
  return (
    <ShowElement value={onShowElement}>
      <WaitingTable
        engine={engine}
        waits={waits}
        nameOf={elementName}
        ElementLink={ShowOnDiagram}
        slots={slots}
      />
    </ShowElement>
  )
}
