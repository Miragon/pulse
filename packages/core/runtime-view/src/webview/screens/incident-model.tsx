import { FileCodeIcon, TriangleAlertIcon, WorkflowIcon } from "lucide-react"
import type { IncidentRow, ModelFacts } from "../../core/protocol/index.js"
import { Button, Icon, type Fact } from "@miragon/pulse-ui"
import { useHost } from "../host/host-context.js"

export class IncidentModel {
  static facts(model: ModelFacts | undefined): readonly Fact[] {
    if (model === undefined) {
      return []
    }
    return [
      ...model.settings.map((setting, index) => ({
        id: `${setting.label}-${index}`,
        label: setting.label,
        value: setting.value,
        mono: true,
        emphasis: true,
      })),
      { id: "model", label: "Model", value: <ModelFile model={model} /> },
    ]
  }
}

function ModelFile({ model }: { readonly model: ModelFacts }) {
  return (
    <>
      {model.fileName}
      {model.differsFromDeployed === true && (
        <span className="inline-flex items-center gap-1">
          ·<Icon icon={TriangleAlertIcon} className="text-warning" />
          {" differs from the deployed version"}
        </span>
      )}
    </>
  )
}

export function IncidentModelActions({ incident }: { readonly incident: IncidentRow }) {
  const host = useHost()
  const model = incident.model
  if (model === undefined) {
    return null
  }
  return (
    <>
      <Button
        type="button"
        variant="outline"
        title={`Open ${model.fileName} at this element`}
        onClick={() => {
          host.post({ type: "openModel", incidentId: incident.id })
        }}
      >
        <Icon icon={WorkflowIcon} />
        Open in model
      </Button>
      {model.codeLabel !== undefined && (
        <Button
          type="button"
          variant="outline"
          title={`Open ${model.codeLabel}`}
          onClick={() => {
            host.post({ type: "openCode", incidentId: incident.id })
          }}
        >
          <Icon icon={FileCodeIcon} />
          Open code
        </Button>
      )}
    </>
  )
}
