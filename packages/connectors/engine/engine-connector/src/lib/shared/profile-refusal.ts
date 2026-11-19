/** The server's code for a call to an engine whose profile it refused. */
export const PROFILE_REFUSED = "ENGINE_PROFILE_REFUSED"

/**
 * What the server says of a call to an engine whose profile it refused, the reason naming keys
 * only, never a value or a variable, so the model can tell the user what whoever runs the server
 * has to fix. One text for the server's refusal (`EngineProfileRefusedError`) and the cockpit's,
 * which says it without a read where the start data or the engine list names the profile refused.
 */
export function profileRefusalText(engineId: string, reason: string): string {
  return `Engine "${engineId}" is configured, but its profile cannot be used: ${reason} Ask whoever runs this server to fix it.`
}

/** The refusal as a tool's error reads (`[ENGINE_PROFILE_REFUSED] …`), which the views word. */
export function profileRefusalError(engineId: string, reason: string): Error {
  return new Error(`[${PROFILE_REFUSED}] ${profileRefusalText(engineId, reason)}`)
}
