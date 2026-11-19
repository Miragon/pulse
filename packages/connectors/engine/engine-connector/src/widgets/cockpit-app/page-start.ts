const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

/**
 * Whether the cockpit's start data (`CockpitAppData.engines`) names `engine` among the engines the
 * server configures, a refused profile too. A page whose address names an engine beyond the view
 * tool's arguments (the web app's address of an engine, which it starts on the landing, the one
 * start every server takes) refuses a start whose data does not, as the tool refuses such an
 * engine at any other address of it: the cockpit never opens an engine the server does not have,
 * so it falls back from none. Data that is no cockpit's names none.
 */
export function cockpitNamesEngine(data: unknown, engine: string): boolean {
  if (!isRecord(data) || !Array.isArray(data.engines)) return false
  return data.engines.some((listed: unknown) => isRecord(listed) && listed.id === engine)
}
