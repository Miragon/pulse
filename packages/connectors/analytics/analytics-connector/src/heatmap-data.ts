/**
 * Why a heatmap has no diagram, so the widget never guesses. Shared by server and
 * widget bundle, so it lives outside both.
 * - `no-engine-module`: diagrams load only through the engine module.
 * - `not-loaded`: no configured engine answered with the model.
 */
export type BpmnMissingReason = "no-engine-module" | "not-loaded"
