import { WorkflowIcon } from "lucide-react"
import type { DefinitionView } from "../../core/protocol/index.js"
import { HeaderButton } from "./header-button.js"

export interface OpenModelButtonProps {
  readonly model: NonNullable<DefinitionView["model"]>
  readonly elementId: string | undefined
  readonly elementName: (elementId: string) => string
}

export function OpenModelButton({ model, elementId, elementName }: OpenModelButtonProps) {
  const at = elementId === undefined ? "" : ` at ${elementName(elementId)}`
  const differs = model.differsFromDeployed === true ? " (differs from the deployed version)" : ""
  return (
    <HeaderButton
      icon={WorkflowIcon}
      label="Open model"
      title={`Open ${model.fileName}${at}${differs}`}
      intent={elementId === undefined ? { type: "openModel" } : { type: "openModel", elementId }}
    />
  )
}
