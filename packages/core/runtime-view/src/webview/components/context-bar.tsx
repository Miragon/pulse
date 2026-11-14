import {
  CircleDotIcon,
  EyeIcon,
  PencilIcon,
  ServerIcon,
  WorkflowIcon,
  type LucideIcon,
} from "lucide-react"
import type { ReactNode } from "react"
import { Icon, ViewBar, cn } from "@miragon/pulse-ui"
import type { EngineBadge } from "../../core/protocol/index.js"
import { useHost } from "../host/host-context.js"
import { BackTarget } from "./back-target.js"
import { FreshnessStamp, LiveButton, type Freshness } from "./live-stamp.js"

export type { Freshness } from "./live-stamp.js"

type Subject = "engine" | "definition" | "instance" | "migration"

const SUBJECT_GLYPHS: Readonly<Record<Subject, LucideIcon>> = {
  engine: ServerIcon,
  definition: WorkflowIcon,
  instance: CircleDotIcon,
  migration: WorkflowIcon,
}

export interface ContextBarProps {
  readonly subject?: Subject
  readonly title: string
  readonly engine: EngineBadge
  readonly freshness: Freshness
  readonly children?: ReactNode
  readonly actions?: ReactNode
}

function AccessChip({ engine }: { readonly engine: EngineBadge }) {
  const writable = engine.access?.writable === true
  return (
    <span
      className="inline-flex items-center gap-1.5"
      data-part="access"
      data-state={writable ? "writable" : "read-only"}
      title={engine.access?.note ?? "Pulse only reads from the engine."}
    >
      <Icon icon={writable ? PencilIcon : EyeIcon} className={cn(writable && "text-link")} />
      {writable ? "Writable" : "Read-only"}
    </span>
  )
}

function HostControls({ engine, freshness }: Pick<ContextBarProps, "engine" | "freshness">) {
  return (
    <>
      <AccessChip engine={engine} />
      <span aria-hidden="true" className="border-border h-4 border-l" />
      {freshness.kind !== "loading" && <LiveButton live={freshness.live} />}
      <FreshnessStamp freshness={freshness} />
    </>
  )
}

export function ContextBar({
  subject,
  title,
  engine,
  freshness,
  children,
  actions,
}: ContextBarProps) {
  const host = useHost()
  return (
    <div className="min-w-0 shrink-0" data-part="context-bar" data-kind={subject ?? "pending"}>
      <ViewBar
        title={title}
        icon={subject === undefined ? undefined : <Icon icon={SUBJECT_GLYPHS[subject]} />}
        {...BackTarget.propsOf(host)}
        facts={children}
        actions={actions}
        live={<HostControls engine={engine} freshness={freshness} />}
      />
    </div>
  )
}
