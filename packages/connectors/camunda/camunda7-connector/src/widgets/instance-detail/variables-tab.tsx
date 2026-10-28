import { HandOffButton } from "@miragon/pulse-widget-shell/widgets"
import type { VariableValue } from "../../view-models.js"
import { VariablesTable } from "../instance-sections.js"
import { useHandOff, type HandOff } from "../lib/hand-off.js"

/** The model reads values through the tool (hosts treat its output as data); a fix is only proposed. */
export function checkVariablesHandOff(
  instanceId: string,
  definitionId: string,
  engineId: string | undefined,
): HandOff {
  return {
    intent: "askAi.instance.checkVariables",
    ids: { engine: engineId, processInstanceId: instanceId, processDefinitionId: definitionId },
    tools: [
      "camunda7_get_process_instance_variables",
      "camunda7_list_incidents",
      "camunda7_set_process_instance_variable",
    ],
  }
}

export function VariablesTab({
  variables,
  instanceId,
  definitionId,
  engineId,
  readOnly,
}: {
  variables: Record<string, VariableValue>
  instanceId: string
  definitionId: string
  engineId?: string
  readOnly: boolean
}) {
  const { ask } = useHandOff()
  return (
    <>
      <div className="mb-2">
        <HandOffButton
          action="checkVariables"
          prompt={ask(checkVariablesHandOff(instanceId, definitionId, engineId))}
        />
      </div>
      <VariablesTable
        variables={variables}
        instanceId={instanceId}
        engine={engineId}
        readOnly={readOnly}
      />
    </>
  )
}
