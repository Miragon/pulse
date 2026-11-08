/**
 * Engine ids the host simulation configures (global-setup.ts) and the
 * scenarios address through a tool's `engine` argument (host-sim.spec.ts).
 * Kept dependency-free so the spec's workers never load the server graph.
 */
export const HEALTHY_ENGINE = "stub"
/** Answers every engine request with a 503 (turns any tool into a real `isError` result). */
export const BROKEN_ENGINE = "down"
/** Real-sized data: long names and keys, 160 instances, 73 jobs (`realistic-engine.ts`). */
export const REALISTIC_ENGINE = "realistic"
/**
 * Env var carrying the stub engine's origin to the workers (set by
 * global-setup.ts). Its `/__control/*` routes let a scenario hold an answer.
 */
export const ENGINE_CONTROL_ENV = "HOST_SIM_ENGINE_URL"
/** Env var carrying the host page of the realistic engine's deployment (set by global-setup.ts). */
export const REALISTIC_HOST_ENV = "HOST_SIM_REALISTIC_URL"
/** Env var carrying the host page of the deployment with a module's own view (global-setup.ts). */
export const OWN_VIEW_HOST_ENV = "HOST_SIM_OWN_VIEW_URL"
/** That module's view tool and feed (own-view-module.ts). */
export const OWN_VIEW_TOOL = "board_show_board"
export const OWN_VIEW_FEED = "board_cards_data"
