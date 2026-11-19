import type { LucideIcon } from "lucide-react"
import { Button, Icon } from "@miragon/pulse-ui"
import type { WebviewIntent } from "../../core/protocol/index.js"
import { useHost } from "../host/host-context.js"

export interface HeaderButtonProps {
  readonly icon: LucideIcon
  readonly label: string
  readonly title: string
  readonly intent: WebviewIntent
}

export function HeaderButton({ icon, label, title, intent }: HeaderButtonProps) {
  const host = useHost()
  return (
    <Button
      type="button"
      variant="toolbar"
      size="sm"
      title={title}
      onClick={() => {
        host.post(intent)
      }}
    >
      <Icon icon={icon} />
      {label}
    </Button>
  )
}
