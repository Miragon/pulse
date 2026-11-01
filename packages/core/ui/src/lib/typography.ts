/**
 * The type scale of the kit (modeler-tool-design §4, adapted for embedded
 * widgets): five steps, each a role in `theme.css` (`--text-<step>` with its
 * line height and weight) and a Tailwind utility of the same name.
 *
 * | Step      | Utility        | Size / weight / line height | Use                                        |
 * | --------- | -------------- | --------------------------- | ------------------------------------------ |
 * | `title`   | `text-title`   | 28 px / 700 / 1.2           | page title (the CI h2; a widget has no h1 40 px) |
 * | `section` | `text-section` | 21 px / 600 / 1.3           | section title (CI h3)                      |
 * | `body`    | `text-body`    | 16 px / 400 / 1.6           | running text: state and toast descriptions |
 * | `dense`   | `text-dense`   | 14 px / 400 / 1.5           | dense tables and controls (inputs, chips, count pills, the inline alert box): the documented product exception, never running text |
 * | `small`   | `text-small`   | 13 px / 400 / 1.5           | captions, labels, hints, meta rows: the FLOOR |
 *
 * Nothing renders below 13 px — no `text-xs` (12 px), no `text-[10px]`
 * micro-labels (`examples/test/design-system.test.ts` enforces it). A label
 * that used to be a 10–11 px uppercase caption is {@link MICRO_LABEL}: 13 px,
 * semibold, normal case.
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
 * labels. 13 px semibold in normal case — the CI floor, where these used to
 * be 10–11 px uppercase. Typography only: add the colour
 * (`text-muted-foreground`) at the call site.
 */
export const MICRO_LABEL = "text-small font-semibold"
