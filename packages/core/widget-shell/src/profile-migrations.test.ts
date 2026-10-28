import { afterEach, describe, expect, it, vi } from "vitest"
import {
  PROFILE_MIGRATION_BASELINE,
  PROFILE_MIGRATIONS,
  migrateStoredProfile,
  parseStoredProfile,
} from "./profile-migrations.js"
import { PROFILE_SCHEMA_VERSION } from "./profile-constants.js"

afterEach(() => {
  vi.restoreAllMocks()
})

const CURRENT = {
  id: "user-1",
  language: "de",
  modules: { analytics: { defaultPeriod: "14d" }, camunda7: { defaultEngineId: "prod-a" } },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
  schemaVersion: PROFILE_SCHEMA_VERSION,
}

/** Shapes the pre-production builds persisted before the baseline: flat module fields. */
const V1_RECORD = {
  id: "user-1",
  language: "de",
  theme: "dark",
  pinnedDashboardIds: ["d1"],
  analyticsDefaultPeriod: "30d",
  analyticsMinBucketSize: 25,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
  schemaVersion: 1,
}
const V2_RECORD = {
  id: "user-1",
  language: "de",
  theme: "dark",
  defaultEngineId: "prod-a",
  allowedEngineIds: ["prod-a"],
  modules: { analytics: { defaultPeriod: "14d" } },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
  schemaVersion: 2,
}

/**
 * Pinned HERE, not read from the export: a baseline raised with a schema bump would empty
 * the completeness range and let the bump pass without its migration.
 */
const SHIPPED_BASELINE = 3

describe("PROFILE_MIGRATIONS completeness", () => {
  it("keeps the migration baseline where it shipped", () => {
    expect(PROFILE_MIGRATION_BASELINE).toBe(SHIPPED_BASELINE)
  })

  it("carries an entry for every version from the baseline up to PROFILE_SCHEMA_VERSION", () => {
    const expected = Array.from(
      { length: PROFILE_SCHEMA_VERSION - SHIPPED_BASELINE },
      (_, i) => SHIPPED_BASELINE + i,
    )
    const actual = Object.keys(PROFILE_MIGRATIONS)
      .map(Number)
      .sort((a, b) => a - b)
    expect(actual).toEqual(expected)
  })
})

describe("parseStoredProfile", () => {
  it("passes a current-version record through unchanged", () => {
    expect(parseStoredProfile(CURRENT)).toEqual(CURRENT)
  })

  // #322: an older record is adopted, never upgraded, and still reads without an error.
  it.each([
    ["v1", V1_RECORD, {}],
    ["v2", V2_RECORD, V2_RECORD.modules],
  ])(
    "reads a %s record from before the baseline fail-soft: its flat fields drop to the defaults",
    (_, stored, modules) => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {})
      expect(parseStoredProfile(stored)).toEqual({
        id: "user-1",
        language: "de",
        modules,
        createdAt: stored.createdAt,
        updatedAt: stored.updatedAt,
        schemaVersion: PROFILE_SCHEMA_VERSION,
      })
      expect(error).not.toHaveBeenCalled()
    },
  )

  it("reads a missing or out-of-range schemaVersion as the baseline", () => {
    const versionless: Record<string, unknown> = { ...CURRENT }
    delete versionless.schemaVersion
    expect(parseStoredProfile(versionless)).toEqual(CURRENT)
    expect(parseStoredProfile({ ...CURRENT, schemaVersion: 0 })).toEqual(CURRENT)
    expect(parseStoredProfile({ ...CURRENT, schemaVersion: 2.5 })).toEqual(CURRENT)
  })

  it("reads a record from a NEWER build best-effort, without running any migration", () => {
    const parsed = parseStoredProfile({
      ...CURRENT,
      newCoreField: true,
      schemaVersion: PROFILE_SCHEMA_VERSION + 1,
    })
    // Untouched: a newer build's document is never reshaped by an older one.
    expect(parsed).toEqual(CURRENT)
  })

  it("reads a record with the retired theme preference: the key never reaches the view", () => {
    // A `theme` an earlier build saved is an unknown key now: no migration, no reset.
    expect(parseStoredProfile({ ...CURRENT, theme: "dark" })).toEqual(CURRENT)
    expect(parseStoredProfile({ ...CURRENT, theme: 42 })).toEqual(CURRENT)
  })

  it("keeps the system language preference — following the host is a stored choice", () => {
    expect(parseStoredProfile({ ...CURRENT, language: "system" })?.language).toBe("system")
  })

  it("degrades an invalid field to ITS default and keeps every other field", () => {
    expect(parseStoredProfile({ ...CURRENT, language: "fr" })).toMatchObject({
      language: "system",
      modules: CURRENT.modules,
    })
    expect(parseStoredProfile({ ...CURRENT, userId: 7 })).toMatchObject({
      language: "de",
      modules: CURRENT.modules,
      userId: undefined,
    })
    expect(parseStoredProfile({ ...CURRENT, modules: "garbage" })?.modules).toEqual({})
  })

  it("prefers the store key over the stored id and repairs missing timestamps", () => {
    expect(parseStoredProfile(CURRENT, "other-key")?.id).toBe("other-key")
    const sparse = parseStoredProfile({ schemaVersion: 3 }, "k")
    expect(sparse).toMatchObject({ id: "k", language: "system", modules: {} })
    expect(sparse?.createdAt).toBe(sparse?.updatedAt)
    expect(
      parseStoredProfile({ schemaVersion: 3, updatedAt: "2026-02-02T00:00:00.000Z" }, "k"),
    ).toMatchObject({
      createdAt: "2026-02-02T00:00:00.000Z",
      updatedAt: "2026-02-02T00:00:00.000Z",
    })
  })

  it("reads garbage as absent", () => {
    expect(parseStoredProfile(null)).toBeUndefined()
    expect(parseStoredProfile("nope")).toBeUndefined()
    expect(parseStoredProfile(["an", "array"])).toBeUndefined()
    expect(parseStoredProfile({ schemaVersion: 0 })).toBeUndefined()
    expect(parseStoredProfile({ ...CURRENT, id: 42 })).toBeUndefined()
  })
})

describe("migrateStoredProfile", () => {
  it("adopts a pre-baseline document at the baseline, keeping its unknown keys raw", () => {
    expect(migrateStoredProfile(V1_RECORD)).toEqual({
      doc: { ...V1_RECORD, schemaVersion: PROFILE_MIGRATION_BASELINE },
      version: PROFILE_MIGRATION_BASELINE,
    })
  })

  it("reports the version the document ends at", () => {
    expect(migrateStoredProfile(CURRENT)?.version).toBe(PROFILE_SCHEMA_VERSION)
    expect(migrateStoredProfile({ ...CURRENT, schemaVersion: 42 })?.version).toBe(42)
    // Anything but an integer number reads as the baseline — never NaN.
    for (const schemaVersion of [undefined, "4", 4.5, null]) {
      expect(migrateStoredProfile({ ...CURRENT, schemaVersion })?.version).toBe(
        PROFILE_MIGRATION_BASELINE,
      )
    }
    expect(migrateStoredProfile(undefined)).toBeUndefined()
    expect(migrateStoredProfile(null)).toBeUndefined()
    expect(migrateStoredProfile([CURRENT])).toBeUndefined()
  })

  it("never mutates the stored JSON it was handed", () => {
    const stored = { ...V1_RECORD }
    const snapshot = structuredClone(stored)
    migrateStoredProfile(stored)
    expect(stored).toEqual(snapshot)
  })

  // Synthetic history: the shipped one has no step yet, but the next bump runs this loop.
  const history = {
    baseline: 1,
    current: 3,
    migrations: {
      1: (raw: Record<string, unknown>) => {
        raw.steps = [...((raw.steps as number[] | undefined) ?? []), 1]
      },
      2: (raw: Record<string, unknown>) => {
        raw.steps = [...((raw.steps as number[] | undefined) ?? []), 2]
      },
    },
  }

  it("upgrades step by step from the stored version, stamping each step", () => {
    expect(migrateStoredProfile({ schemaVersion: 1 }, history)).toEqual({
      doc: { schemaVersion: 3, steps: [1, 2] },
      version: 3,
    })
    expect(migrateStoredProfile({ schemaVersion: 2 }, history)).toEqual({
      doc: { schemaVersion: 3, steps: [2] },
      version: 3,
    })
  })

  it("stops at a version without its step (a build bug) and keeps the document there", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    const gap = { ...history, migrations: { 1: history.migrations[1] } }
    expect(migrateStoredProfile({ schemaVersion: 1 }, gap)).toEqual({
      doc: { schemaVersion: 2, steps: [1] },
      version: 2,
    })
    expect(error).toHaveBeenCalledTimes(1)
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("No profile migration from schema v2"),
    )
  })
})
