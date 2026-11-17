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
/** A profile the server refuses (its secret's variable is not set): the landing lists it. */
export const REFUSED_ENGINE = "locked"
/** An engine that answers the server's login with a 401: it runs, so it is not unreachable. */
export const LOGIN_REFUSED_ENGINE = "wrong-login"
/** An engine that denies the server's account the read with a 403: it runs too. */
export const ACCESS_DENIED_ENGINE = "no-access"
/**
 * Env var carrying the host page of the deployment with a refused profile and two engines that
 * refuse the server's login (global-setup.ts).
 */
export const REFUSED_HOST_ENV = "HOST_SIM_REFUSED_URL"
/** Env var carrying the host page of the deployment with a module's own view (global-setup.ts). */
export const OWN_VIEW_HOST_ENV = "HOST_SIM_OWN_VIEW_URL"
/** That module's view tool and feed (own-view-module.ts). */
export const OWN_VIEW_TOOL = "board_show_board"
export const OWN_VIEW_FEED = "board_cards_data"
/**
 * Env var carrying the host page of the deployment with board files (`fixtures/boards`, through
 * ENGINE_BOARDS_DIR) over the healthy and the broken engine (set by global-setup.ts).
 */
export const BOARD_HOST_ENV = "HOST_SIM_BOARD_URL"
/** Its board over both engines, every kind of tile and one the file breaks. */
export const INVOICES_BOARD = "invoices"
/** Its board file that gives no board (its title is missing). */
export const BROKEN_BOARD = "broken"
/**
 * Env var carrying the host page of the deployment with one engine, the healthy one, and a board
 * over it (`fixtures/one-engine-boards`): the landing shows with one engine too (set by
 * global-setup.ts).
 */
export const ONE_ENGINE_BOARD_HOST_ENV = "HOST_SIM_ONE_ENGINE_BOARD_URL"
/** Its board over the healthy engine. */
export const APPROVALS_BOARD = "approvals"
/**
 * Env var carrying the host page of the Camunda 8 deployment (global-setup.ts): the healthy stub
 * engine beside a loopback Camunda 8 cluster (c8-engine.ts) under two profiles, and a board over
 * the stub and one of them (`fixtures/camunda8-boards`).
 */
export const CAMUNDA8_HOST_ENV = "HOST_SIM_CAMUNDA8_URL"
/** Env var carrying that cluster's origin, whose control counts what it was asked. */
export const C8_CONTROL_ENV = "HOST_SIM_C8_ENGINE_URL"
/** The Camunda 8 engine a board names: client credentials, its Operate at C8_OPERATE. */
export const C8_ENGINE = "c8-orders"
/** A Camunda 8 engine no board names, on the same cluster. */
export const C8_UNBOARDED_ENGINE = "c8-billing"
/** The C8 engine's web app, as its profile's cockpitUrl names it. */
export const C8_OPERATE = "https://operate.example.com/operate"
/** The board over the stub and the C8 engine. */
export const ORDERS_BOARD = "orders"
