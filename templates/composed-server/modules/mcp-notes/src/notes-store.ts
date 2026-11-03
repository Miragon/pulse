/**
 * In-memory demo data source so the example module runs with zero external
 * infrastructure. A real module would put its client/SDK access here (compare
 * `@miragon/pulse-analytics-client` feeding the analytics module); the tools and
 * widgets only ever see the `NotesStore` interface.
 */

export interface Note {
  id: string
  title: string
  text: string
  tags: string[]
  updatedAt: string
}

/**
 * The notes view's data: the show tool's `structuredContent` and the feed's answer. It carries
 * the filter it was read with, so the widget re-reads its feed with the same arguments.
 */
export interface NotesListData {
  title: string
  query: string | null
  notes: Note[]
}

export interface NotesStore {
  list(filter?: { query?: string }): Note[]
}

const SEED: Note[] = [
  {
    id: "n-1",
    title: "Retry policy for the payment gateway",
    text: "External task workers retry 3x with backoff; incidents beyond that need manual triage in the cockpit.",
    tags: ["operations", "payments"],
    updatedAt: "2026-07-28T09:15:00Z",
  },
  {
    id: "n-2",
    title: "Nightly batch window",
    text: "The archive job runs 01:00–03:00 UTC; avoid deployments and engine restarts in that window.",
    tags: ["operations"],
    updatedAt: "2026-07-30T16:40:00Z",
  },
  {
    id: "n-3",
    title: "Escalation contact for leasing",
    text: "Leasing process incidents page the risk team first — see the runbook for the on-call rotation.",
    tags: ["escalation", "leasing"],
    updatedAt: "2026-08-01T07:05:00Z",
  },
]

export function createNotesStore(): NotesStore {
  return {
    list(filter) {
      const query = filter?.query?.trim().toLowerCase()
      if (!query) return SEED
      return SEED.filter((note) =>
        [note.title, note.text, ...note.tags].some((field) => field.toLowerCase().includes(query)),
      )
    },
  }
}
