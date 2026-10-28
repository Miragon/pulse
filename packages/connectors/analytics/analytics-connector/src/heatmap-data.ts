/**
 * Why a heatmap has no diagram, so the widget never guesses. Shared by server and
 * widget bundle, so it lives outside both.
 * - `no-camunda7`: diagrams load only through the camunda7 module.
 * - `not-loaded`: no configured engine answered with the model.
 */
export type BpmnMissingReason = "no-camunda7" | "not-loaded"
