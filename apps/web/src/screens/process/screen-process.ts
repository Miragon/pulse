/**
 * A process as the page's process screen reads it (owner decision 2026-11-26, F17): a key in one
 * tenant, the tenant none where the place names none. The address carries the tenant as
 * `?tenant=` only where a process has one (`src/router/screen-queries.ts`), so a process without a
 * tenant keeps the address it had; the process screen's feed takes it as `tenantId`, the same
 * parameter the model's screen tool takes, and a version's link carries the tenant its definition
 * names.
 */

/** A key in one tenant; `tenantId` none for the process without a tenant. */
export interface ScreenProcess {
  readonly key: string
  readonly tenantId?: string
}

/** The process a place names: its key, and its tenant where the place names one. */
export function screenProcessOf(place: {
  readonly process: string
  readonly tenantId?: string | undefined
}): ScreenProcess {
  return place.tenantId === undefined
    ? { key: place.process }
    : { key: place.process, tenantId: place.tenantId }
}

/** The tenant of `process` as a place's field: none for the process without a tenant. */
export function tenantFieldOf(tenantId: string | undefined): { readonly tenantId?: string } {
  return tenantId === undefined ? {} : { tenantId }
}

/** The process screen feed's arguments for `process` on `engine`, the version where one is asked. */
export function processArgsOf(
  engine: string,
  process: ScreenProcess,
  version: number | undefined,
): Readonly<Record<string, unknown>> {
  return {
    engine,
    process: process.key,
    ...tenantFieldOf(process.tenantId),
    ...(version === undefined ? {} : { version }),
  }
}
