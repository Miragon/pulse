import type { IncidentTextKind, InstanceScreenData } from "@miragon/pulse-screens"

/**
 * The instance screen's feed (the engine module's `SCREEN_FEEDS`): an app-only read of the engine
 * contract in every dialect, which the page's forward admits (`test/page-reads.test.ts`).
 */
export const INSTANCE_SCREEN_FEED = "engine_screen_instance_data"

/** The feed of a root incident's text, read only when the reader opens it. */
export const INCIDENT_TEXT_FEED = "engine_screen_incident_text_data"

/** The feed of an incident by its id (Camunda 7's cockpit): where it lies, its root among it. */
export const INCIDENT_DETAIL_FEED = "engine_incident_detail_data"

/** The feed of a version's diagram, which every diagram of the page draws. */
export const BPMN_XML_FEED = "engine_bpmn_xml_data"

/**
 * The instance screen's cache key, per engine and instance: one read the screen and its Refresh
 * share, which an incident of the instance in focus reads from too.
 */
export const instanceScreenKey = (engine: string, instance: string): readonly unknown[] => [
  "web:instance-screen",
  engine,
  instance,
]

/** A root incident's text's cache key: read once, when the reader first opens it. */
export const incidentTextKey = (engine: string, incident: string): readonly unknown[] => [
  "web:incident-text",
  engine,
  incident,
]

/** A version's diagram's cache key. */
export const diagramKey = (engine: string, definitionId: string): readonly unknown[] => [
  "web:bpmn-xml",
  engine,
  definitionId,
]

/** An instance in the engine's own web app: its address and its vendor's name. */
interface InstanceWebApp {
  readonly url: string
  readonly vendor: string
}

/** A root incident's cause as the cockpit's cause view takes it (Camunda 7). */
export interface IncidentCause {
  readonly incidentId: string
  readonly activityId: string
  readonly incidentType: string
  readonly signature: string
}

/**
 * What the feed answers: the instance screen in the JSON form of `@miragon/pulse-screens` (the
 * numbers the editors' instance view shows), the instance in the engine's web app where the
 * engine's provider knows its address, and each root incident's cause on Camunda 7 (null on
 * another dialect, whose cockpit has no cause view).
 */
export interface InstanceScreenFeed extends InstanceScreenData {
  readonly webApp: InstanceWebApp | null
  readonly causes: readonly IncidentCause[] | null
}

/** What the text feed answers: the text, whether it was cut, its root cause and that cause's line. */
export interface IncidentTextFeed {
  readonly incidentId: string
  readonly kind: IncidentTextKind
  readonly text: string
  readonly truncated: boolean
  readonly rootCause: string | null
  readonly rootCauseLine: number | null
}

/** What the page reads of an incident by its id: its instance, and its root where it is a copy. */
export interface IncidentDetailFeed {
  readonly processInstanceId: string
  readonly rootCause: { readonly incidentId: string; readonly processInstanceId: string } | null
}

/** The feed's refusal of an instance the engine does not know: its code leads the server's text. */
const UNKNOWN_INSTANCE = /^\[UNKNOWN_INSTANCE\]/

/**
 * Whether the screen's read found no such instance on its engine, running or ended: a refusal no
 * retry changes, so the page neither reads it again by itself nor offers Try again.
 */
export function isUnknownInstance(error: unknown): boolean {
  return error instanceof Error && UNKNOWN_INSTANCE.test(error.message)
}

/** The text feed's refusal of an incident it holds no text of: its code leads the server's text. */
const UNKNOWN_INCIDENT = /^\[UNKNOWN_INCIDENT\]/

/**
 * Whether a text's read found no text of the incident: no longer open (resolved since the screen
 * read it), or one the engine keeps no text for. A refusal no retry changes: the card says so once
 * and offers no Try again.
 */
export function isUnknownIncident(error: unknown): boolean {
  return error instanceof Error && UNKNOWN_INCIDENT.test(error.message)
}
