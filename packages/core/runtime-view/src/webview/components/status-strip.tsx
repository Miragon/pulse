import {
  CircleXIcon,
  InfoIcon,
  LoaderCircleIcon,
  TriangleAlertIcon,
  type LucideIcon,
} from "lucide-react"
import { Button, Icon, StatusStrip as KitStatusStrip, cn } from "@miragon/pulse-ui"
import type { Tone } from "../../core/protocol/index.js"

export interface StripAction {
  readonly label: string
  readonly icon: LucideIcon
  readonly onClick: () => void
  readonly busyLabel?: string | undefined
  readonly disabled?: boolean
}

export interface StatusStripProps {
  readonly tone: Tone
  readonly title: string
  readonly detail?: string | undefined
  readonly actions?: readonly StripAction[]
}

export const TONE_GLYPHS: Readonly<Record<Tone, LucideIcon>> = {
  info: InfoIcon,
  warning: TriangleAlertIcon,
  danger: CircleXIcon,
}

export function StripButton({ action }: { readonly action: StripAction }) {
  const busy = action.busyLabel !== undefined
  const label = action.busyLabel ?? action.label
  return (
    <Button
      type="button"
      variant="outline"
      size="xs"
      title={label}
      aria-label={label}
      disabled={busy || action.disabled === true}
      onClick={action.onClick}
    >
      <Icon
        icon={busy ? LoaderCircleIcon : action.icon}
        className={cn(busy && "motion-safe:animate-spin")}
      />
      <span data-slot="button-label">{label}</span>
    </Button>
  )
}

export function StatusStrip({ tone, title, detail, actions = [] }: StatusStripProps) {
  return (
    <KitStatusStrip
      tone={tone}
      icon={TONE_GLYPHS[tone]}
      title={title}
      {...(detail === undefined ? {} : { detail })}
      actions={actions.map((action) => ({
        label: action.label,
        icon: action.icon,
        onClick: action.onClick,
        ...(action.busyLabel === undefined ? {} : { busyLabel: action.busyLabel }),
        ...(action.disabled === undefined ? {} : { disabled: action.disabled }),
      }))}
    />
  )
}
