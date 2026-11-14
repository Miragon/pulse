import { CircleXIcon, InfoIcon, TriangleAlertIcon, type LucideIcon } from "lucide-react"
import { Button, ErrorState } from "@miragon/pulse-ui"
import type { Tone } from "../../core/protocol/index.js"

export interface StatusAction {
  readonly label: string
  readonly onClick: () => void
}

export interface StatusBoxProps {
  readonly tone: Tone
  readonly title: string
  readonly detail?: string | undefined
  readonly actions?: readonly StatusAction[]
}

const GLYPHS: Readonly<Record<Tone, LucideIcon>> = {
  info: InfoIcon,
  warning: TriangleAlertIcon,
  danger: CircleXIcon,
}

function BoxActions({ actions }: { readonly actions: readonly StatusAction[] }) {
  return actions.map((action) => (
    <Button key={action.label} type="button" variant="outline" onClick={action.onClick}>
      {action.label}
    </Button>
  ))
}

export function StatusBox({ tone, title, detail, actions = [] }: StatusBoxProps) {
  return (
    <div
      className="flex w-full justify-center"
      data-part="status-box"
      data-tone={tone}
      role={tone === "danger" ? "alert" : "status"}
    >
      <ErrorState
        tone={tone}
        icon={GLYPHS[tone]}
        role="none"
        titleAs="p"
        title={title}
        description={detail}
        actions={actions.length > 0 ? <BoxActions actions={actions} /> : undefined}
      />
    </div>
  )
}
