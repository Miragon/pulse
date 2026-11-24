import {
  ArrowUpRightIcon,
  BanIcon,
  ClipboardListIcon,
  FileCodeIcon,
  FileTextIcon,
  PencilIcon,
  RotateCcwIcon,
  SearchIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react"
import type { Notice, NoticeAction, Problem, WebviewIntent } from "../../core/protocol/index.js"
import { StatusBox, type StatusAction } from "../components/status-box.js"
import { StatusStrip, type StripAction } from "../components/status-strip.js"
import { useHost } from "../host/host-context.js"
import { useWriteState } from "../host/write-context.js"
import { WriteStates } from "../host/write-states.js"
import { NoticeIntents } from "./notice-intents.js"

const ICONS: Readonly<Record<NoticeAction["kind"], LucideIcon>> = {
  openInstance: ArrowUpRightIcon,
  selectVersion: ArrowUpRightIcon,
  openIncidentDetails: FileTextIcon,
  retryIncident: RotateCcwIcon,
  stopBulk: BanIcon,
  selectRemaining: ClipboardListIcon,
  dismissBulk: XIcon,
  checkBulk: SearchIcon,
  showBulkFailures: FileTextIcon,
}

export function useStripActions(actions: readonly NoticeAction[]): StripAction[] {
  const host = useHost()
  const write = useWriteState()
  return actions.map((action) => {
    const retrying =
      action.kind === "retryIncident" &&
      WriteStates.on(write, { kind: "incident", incidentId: action.incidentId })?.status ===
        "pending"
    return {
      label: action.label,
      icon: ICONS[action.kind],
      busyLabel: retrying ? "Retrying…" : undefined,
      disabled: action.kind === "retryIncident" && WriteStates.isWriting(write),
      onClick: () => {
        host.post(NoticeIntents.of(action))
      },
    }
  })
}

export function NoticeStrip({ notice }: { readonly notice: Notice }) {
  const actions = useStripActions(notice.actions)
  return (
    <StatusStrip tone={notice.tone} title={notice.title} detail={notice.detail} actions={actions} />
  )
}

export function NoticeStrips({ notices }: { readonly notices: readonly Notice[] }) {
  return (
    <>
      {notices.map((notice) => (
        <NoticeStrip key={`${notice.tone}:${notice.title}`} notice={notice} />
      ))}
    </>
  )
}

interface ProblemAction extends StatusAction {
  readonly icon: LucideIcon
}

function useProblemActions(problem: Problem): ProblemAction[] {
  const host = useHost()
  const action = (label: string, icon: LucideIcon, intent: WebviewIntent): ProblemAction => ({
    label,
    icon,
    onClick: () => {
      host.post(intent)
    },
  })
  if (problem.file !== undefined) {
    return [
      action("Refresh", RotateCcwIcon, { type: "refresh" }),
      action("Open file", FileCodeIcon, { type: "openPlanFile" }),
    ]
  }
  const reconnect = action("Reconnect", RotateCcwIcon, { type: "refresh" })
  if (problem.needsCredentials === true) {
    return [reconnect, action("Set credentials…", PencilIcon, { type: "setCredentials" })]
  }
  return problem.canEditConnection
    ? [reconnect, action("Edit connection…", PencilIcon, { type: "editConnection" })]
    : [reconnect]
}

export function ProblemStrip({ problem }: { readonly problem: Problem }) {
  const actions = useProblemActions(problem)
  return (
    <StatusStrip tone="danger" title={problem.title} detail={problem.detail} actions={actions} />
  )
}

export function ProblemBox({ problem }: { readonly problem: Problem }) {
  const actions: StatusAction[] = useProblemActions(problem)
  return <StatusBox tone="danger" title={problem.title} detail={problem.detail} actions={actions} />
}
