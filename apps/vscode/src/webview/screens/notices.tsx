import { glyphs } from "../components/lucide-glyphs.json"
import type { Notice, NoticeAction, Problem, WebviewIntent } from "../../core/protocol/index.js"
import { StatusBox } from "../components/status-box.js"
import type { StatusAction } from "../components/status-box.js"
import { StatusStrip } from "../components/status-strip.js"
import type { StripAction } from "../components/status-strip.js"
import { useHost } from "../host/host-context.js"
import { useWriteState } from "../host/write-context.js"
import { WriteStates } from "../host/write-states.js"
import { NoticeIntents } from "./notice-intents.js"

const ICONS: Readonly<Record<NoticeAction["kind"], string>> = {
  openInstance: glyphs.ArrowUpRight,
  selectVersion: glyphs.ArrowUpRight,
  openIncidentDetails: glyphs.FileText,
  retryIncident: glyphs.RotateCcw,
  stopBulk: glyphs.Ban,
  selectRemaining: glyphs.ClipboardList,
  dismissBulk: glyphs.X,
  checkBulk: glyphs.Search,
  showBulkFailures: glyphs.FileText,
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

function useProblemActions(problem: Problem) {
  const host = useHost()
  const action = (label: string, intent: WebviewIntent): StatusAction => ({
    label,
    onClick: () => {
      host.post(intent)
    },
  })
  const reconnect = action("Reconnect", { type: "refresh" })
  if (problem.needsCredentials === true) {
    return [reconnect, action("Set credentials…", { type: "setCredentials" })]
  }
  return problem.canEditConnection
    ? [reconnect, action("Edit connection…", { type: "editConnection" })]
    : [reconnect]
}

export function ProblemStrip({ problem }: { readonly problem: Problem }) {
  const actions = useProblemActions(problem).map((action) => ({
    ...action,
    icon: action.label === "Reconnect" ? glyphs.RotateCcw : glyphs.Pencil,
  }))
  return (
    <StatusStrip tone="danger" title={problem.title} detail={problem.detail} actions={actions} />
  )
}

export function ProblemBox({ problem }: { readonly problem: Problem }) {
  const actions: StatusAction[] = useProblemActions(problem)
  return <StatusBox tone="danger" title={problem.title} detail={problem.detail} actions={actions} />
}
