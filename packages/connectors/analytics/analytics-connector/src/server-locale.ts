import {
  createLocalizeFor,
  createLocalizeViewFor,
  resolveProfileKey,
} from "@miragon/pulse-widget-shell/server"
import { translator } from "./messages/index.js"

/**
 * The profile port + key resolution come from the shared server kit, NOT from a
 * module-local copy: every module reads and writes the same profile record, so
 * a divergent key precedence (or a differently-spelled anonymous fallback)
 * would silently split a user's settings across two records. Re-exported under
 * this module's names so the call sites read in analytics vocabulary.
 *
 * `ProfileSource` is the minimal read/write view a module needs — the locale
 * plus its own slice under `modules.analytics`. camunda7's `ProfileStore`
 * satisfies it structurally, without analytics depending on the camunda7
 * module; `save` merges per module key on the store side, so writing
 * `modules.analytics` never touches other modules' slices.
 */
export type { ProfileSlice, ProfileSource } from "@miragon/pulse-widget-shell/server"

/**
 * Resolve the profile key for the in-flight request: the OAuth caller (off the
 * tool-handler `ctx`), else `anonymous` for an explicitly declared local
 * caller (stdio, tests). A request without OAuth resolves `undefined` — reads
 * fall back to defaults, saves fail visibly, so unrelated callers never
 * cross-share one record.
 */
export const resolveSettingsKey = resolveProfileKey

/** A locale-bound translate for summaries; a show tool's summary translate + view title. */
export type { ServerT, ViewLocale } from "@miragon/pulse-widget-shell/server"

/**
 * Resolve the request locale and return a translate bound to it + the analytics
 * catalogs — `const t = await localizeFor(store, ctx); … summary: t("key", { … })`.
 * Pass the tool-handler `ctx` so an auth user id resolves the same record the
 * save path writes. Locale resolution + the fail-soft rules (no store, no key,
 * store OUTAGE → English) come from the shared `createLocalizeFor`.
 */
export const localizeFor = createLocalizeFor(translator)

/**
 * {@link localizeFor} plus the view title, from ONE profile read — the kit's
 * one title rule for every module's show tools: a view is titled only in a
 * language the profile names; with "system" (the default), no caller or a
 * store outage it carries no title, and the widget's own heading names it in
 * the host's language (#322 U3). Summaries stay `t`:
 * `const { t, title } = await localizeViewFor(store, ctx); … title: title("key")`.
 */
export const localizeViewFor = createLocalizeViewFor(translator)
