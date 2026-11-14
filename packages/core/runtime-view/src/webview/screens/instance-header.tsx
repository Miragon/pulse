import { ClipboardListIcon, CornerLeftUpIcon } from "lucide-react"
import type { InstanceHeader } from "../../core/protocol/index.js"
import { HeaderButton } from "../components/header-button.js"
import { cn, Icon } from "@miragon/pulse-ui"
import { IdText } from "../components/id-text.js"
import { TimeLabels } from "../format/time-labels.js"
import { useHost } from "../host/host-context.js"
import { LinkButton } from "./called-instance-link.js"

const SHRINK = "max-w-full min-w-[4ch] flex-[0_1_auto]"

function Timing({ instance }: { readonly instance: InstanceHeader }) {
  const at = instance.endedAt ?? instance.startedAt
  if (at === undefined) {
    return null
  }
  const verb = instance.endedAt === undefined ? "Started" : "Ended"
  return (
    <span
      className="text-small text-muted-foreground tabular-nums max-[900px]:hidden"
      title={TimeLabels.tooltip(at)}
    >
      {verb} {TimeLabels.precise(at)}
    </span>
  )
}

function DefinitionLink({ instance }: { readonly instance: InstanceHeader }) {
  const host = useHost()
  const label = `${instance.processName} v${instance.version}`
  return (
    <LinkButton
      className={cn(SHRINK, "inline-block truncate")}
      title={`Show definition ${label}`}
      onClick={() => {
        host.post({
          type: "openDefinition",
          bpmnProcessId: instance.bpmnProcessId,
          definitionId: instance.definitionId,
        })
      }}
    >
      {label}
    </LinkButton>
  )
}

function ParentLink({ parent }: { readonly parent: NonNullable<InstanceHeader["parent"]> }) {
  const host = useHost()
  return (
    <LinkButton
      className={cn(SHRINK, "max-w-[24ch] overflow-hidden")}
      data-part="caller-link"
      title={`Open the calling instance ${parent.instanceId}`}
      onClick={(event) => {
        host.post({
          type: "openInstance",
          instanceId: parent.instanceId,
          toSide: event.metaKey || event.ctrlKey,
        })
      }}
    >
      <Icon icon={CornerLeftUpIcon} dense />
      <span className="min-w-0 truncate">{parent.label}</span>
    </LinkButton>
  )
}

export function InstanceHeaderDetails({ instance }: { readonly instance: InstanceHeader }) {
  return (
    <>
      <IdText id={instance.id} shortId={instance.shortId} label="instance ID" />
      <DefinitionLink instance={instance} />
      {instance.parent !== undefined && <ParentLink parent={instance.parent} />}
      <Timing instance={instance} />
    </>
  )
}

export function InstanceHeaderActions() {
  return (
    <HeaderButton
      icon={ClipboardListIcon}
      label="Copy handover"
      title="Copy a Markdown handover of this instance, without variables"
      intent={{ type: "copyHandover" }}
    />
  )
}
