import { CopyableId } from "@miragon/pulse-ui"
import { useHost } from "../host/host-context.js"

export interface IdTextProps {
  readonly id: string
  readonly shortId: string
  readonly label: string
}

export function IdText({ id, label }: IdTextProps) {
  const host = useHost()
  return (
    <CopyableId
      id={id}
      label={label}
      onCopy={(text) => {
        host.post({ type: "copy", text, label })
      }}
    />
  )
}
