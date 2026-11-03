/**
 * Names of the notes tools referenced from widget code, so a tool rename in
 * `widget-tools.ts` trips a TS error at every call site (same rule as the
 * engine/analytics modules' tool-names.ts).
 */
export const NOTES_LIST_DATA = "notes_list_data"
/** The show tool; its name is also its view's name (`widgets/index.ts`). */
export const NOTES_SHOW_NOTES = "notes_show_notes"
