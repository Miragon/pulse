/**
 * The type scale of the kit (modeler-tool-design §4, adapted for embedded
 * widgets): five steps, each a role in `theme.css` (`--text-<step>` with its
 * line height and weight) and a Tailwind utility of the same name.
 *
 * | Step      | Utility        | Size / weight / line height | Use                                        |
 * | --------- | -------------- | --------------------------- | ------------------------------------------ |
 * | `title`   | `text-title`   | 28 px / 700 / 1.2           | page title (the CI h2; a widget has no h1 40 px) |
 * | `section` | `text-section` | 21 px / 600 / 1.3           | a dialog's title (CI h3) and a KPI figure; a section's heading is {@link MICRO_LABEL} at its level |
 * | `body`    | `text-body`    | 16 px / 400 / 1.6           | running text: state and toast descriptions |
 * | `dense`   | `text-dense`   | 13 px / 400 / 1.5           | tables and controls (buttons, tabs, menu entries, segments, chips, count pills, the inline alert box) and the primitives' short descriptions (card, dialog) |
 * | `small`   | `text-small`   | 13 px / 400 / 1.5           | captions, labels, hints, meta rows, badges: the FLOOR |
 *
 * `dense` is the guide's klein step (§8: forms and tables 13 px), the same
 * size as `small`; the two keep their names because they mean different
 * things, so a call site says what its text IS and the scale changes in one
 * place.
 *
 * Nothing renders below 13 px: no `text-xs` (12 px), no `text-[10px]`
 * micro-labels. A label that used to be a 10–11 px uppercase caption is
 * {@link MICRO_LABEL}: 13 px, semibold, normal case.
 *
 * The labels bpmn-js draws on a BPMN canvas are not on this scale: they keep
 * bpmn-js's Arial at 12 and 11 px in the diagram's units, which the canvas
 * zooms (`BPMN_LABEL_STYLE`).
 *
 * Weights are 400 (`font-normal`), 600 (`font-semibold`) and 700
 * (`font-bold`) only, as in the guide: no 500.
 *
 * `scanTypeScale` of `@miragon/pulse-ui/testing` holds a source tree to the
 * steps, the floor and the weights.
 *
 * A field's text is a role of its own, {@link FIELD_TEXT} (`text-field`): 13 px, 16 px on a
 * coarse pointer.
 *
 * Combine the utilities through the kit's `cn`: plain tailwind-merge does not
 * know these sizes and would drop `text-small` next to a text colour.
 */

/** The five steps, smallest last. */
export const TYPE_STEPS = ["title", "section", "body", "dense", "small"] as const

/** One step of the type scale. */
export type TypeStep = (typeof TYPE_STEPS)[number]

/** The utility class per step (`TYPE_SCALE.small` → `"text-small"`). */
export const TYPE_SCALE: Readonly<Record<TypeStep, `text-${TypeStep}`>> = {
  title: "text-title",
  section: "text-section",
  body: "text-body",
  dense: "text-dense",
  small: "text-small",
}

/** The smallest text the kit renders, in CSS px (CI §4 "klein"). */
export const TYPE_FLOOR_PX = 13

/**
 * A caption above a value or a column: table heads, KPI labels, group
 * labels, and the compact heading of a section (`Section`, `SectionHeading`,
 * an `h2` over a block). 13 px semibold in normal case: the CI floor, where
 * these used to be 10–11 px uppercase. Typography only: add the colour
 * (`text-muted-foreground`) at the call site.
 */
export const MICRO_LABEL = "text-small font-semibold"

/**
 * The text of a field (an input, a textarea, a native select, a search field): the utility over
 * the field's text role, `--field-text` in `theme.css`, on the dense step's line height. It is
 * 13 px, and 16 px once any pointer is coarse: iOS zooms the page into a field whose text is under
 * 16 px when it takes focus, a chat app's embedded view included. A host that pins the compact
 * step (`data-density="compact"`, the editors on a touch laptop) keeps it at 13 px, and
 * `data-density="comfortable"` alone never raises it: density never scales type, only the pointer
 * does, and only here.
 */
export const FIELD_TEXT = "text-field"
