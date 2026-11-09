import { glyphs } from "../components/lucide-glyphs.json"
import type { InstanceHeader } from "../../core/protocol/index.js"
import { HeaderButton } from "../components/header-button.js"
import { Icon } from "../components/icon.js"
import { IdText } from "../components/id-text.js"
import { TimeLabels } from "../format/time-labels.js"
import { useHost } from "../host/host-context.js"

function Timing({ instance }: { readonly instance: InstanceHeader }) {
  const at = instance.endedAt ?? instance.startedAt
  if (at === undefined) {
    return null
  }
  const verb = instance.endedAt === undefined ? "Started" : "Ended"
  return (
    <span class="muted context-bar__optional" title={TimeLabels.tooltip(at)}>
      {verb} {TimeLabels.precise(at)}
    </span>
  )
}

function DefinitionLink({ instance }: { readonly instance: InstanceHeader }) {
  const host = useHost()
  const label = `${instance.processName} v${instance.version}`
  return (
    <button
      type="button"
      class="link-button context-bar__shrink"
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
    </button>
  )
}

function ParentLink({ parent }: { readonly parent: NonNullable<InstanceHeader["parent"]> }) {
  const host = useHost()
  return (
    <button
      type="button"
      class="link-button context-bar__shrink context-bar__shrink--with-icon"
      title={`Open the calling instance ${parent.instanceId}`}
      onClick={(event) => {
        host.post({
          type: "openInstance",
          instanceId: parent.instanceId,
          toSide: event.metaKey || event.ctrlKey,
        })
      }}
    >
      <Icon of={glyphs.CornerLeftUp} size={12} />
      <span class="context-bar__shrink-text">{parent.label}</span>
    </button>
  )
}

export function InstanceHeaderDetails({ instance }: { readonly instance: InstanceHeader }) {
  return (
    <>
      <IdText id={instance.id} shortId={instance.shortId} label="instance ID" />
      <DefinitionLink instance={instance} />
      {instance.parent !== undefined && <ParentLink parent={instance.parent} />}
      <Timing instance={instance} />
      <HeaderButton
        icon={glyphs.ClipboardList}
        label="Copy handover"
        title="Copy a Markdown handover of this instance, without variables"
        intent={{ type: "copyHandover" }}
      />
    </>
  )
}
