import type { UserProfile } from "../lib/profile-schema.js"

export interface FormState {
  // #322 U25: includes engines configured later.
  allEngines: boolean
  allowedEngineIds: string[]
  defaultEngineId: string
}

export function fromProfile(p: UserProfile, engineIds: string[]): FormState {
  // An empty/absent allow-list means "all"; switched off, the list starts
  // with every engine checked.
  const curated = !!p.allowedEngineIds && p.allowedEngineIds.length > 0
  return {
    allEngines: !curated,
    allowedEngineIds: curated ? (p.allowedEngineIds ?? []) : engineIds,
    defaultEngineId: p.defaultEngineId ?? "",
  }
}

export function allowedIn(form: FormState, engineIds: string[]): string[] {
  return form.allEngines ? engineIds : form.allowedEngineIds
}

export function isDirty(form: FormState, baseline: FormState, engineIds: string[]): boolean {
  return Object.keys(changedPreferences(form, baseline, engineIds)).length > 0
}

const sameSet = (a: string[], b: string[]) =>
  a.length === b.length && a.every((id) => b.includes(id))

// Only changed fields: the view may be stale and another writer (`camunda7_select_engine`, a
// second tab) may have saved meanwhile; re-sending untouched fields would write old values back.
export function changedPreferences(
  form: FormState,
  baseline: FormState,
  engineIds: string[],
): Record<string, unknown> {
  const payload: Record<string, unknown> = {}
  if (form.defaultEngineId !== baseline.defaultEngineId) {
    payload.defaultEngineId = form.defaultEngineId
  }
  const allowed = allowedIn(form, engineIds)
  if (!sameSet(allowed, allowedIn(baseline, engineIds))) {
    // [] is the "all engines" encoding, so engines configured later are included.
    payload.allowedEngineIds = form.allEngines || sameSet(allowed, engineIds) ? [] : allowed
  }
  return payload
}
