import type { JobsFilters } from "./feed-contracts.js"

/** The jobs' view models: the jobs list's page and one engine's job backlog. */

/**
 * One engine's job backlog right now, four counts of that engine alone: the cross-engine
 * overview compares them across engines, since no process mix is in them.
 */
export interface JobBacklogData {
  /** Jobs the job executor runs next: retries left, due and active (c7-core's `EXECUTABLE`). */
  executableJobs: number
  suspendedJobs: number
  /** Jobs due later than now: timers, and retries waiting out their back-off. */
  jobsDueLater: number
  /** External tasks waiting for a worker or locked by one. */
  externalTasks: number
  engineId: string
}

interface Job {
  id: string
  processInstanceId: string
  processDefinitionKey: string | null
  processDefinitionId: string | null
  /** The process's name (the job's definition version); null without one or unread. */
  processDefinitionName: string | null
  activityId: string | null
  /** The failing activity's name in the job's diagram; null without one or unread. */
  activityName: string | null
  retries: number
  exceptionMessage: string | null
  dueDate: string | null
  suspended: boolean
  priority: number
  createTime: string | null
}

export interface JobPanelData {
  /** The listed scope's total, the page's: `failedCount` without retries only, else `allCount`. */
  totalCount: number
  /** Every job in the process scope, whichever scope is listed (the All segment's count). */
  allCount: number
  /** The jobs without retries in the process scope, whichever scope is listed. */
  failedCount: number
  jobs: Job[]
  /** The filters the page on screen was read with; hand-offs and model contexts state its scope. */
  filters: JobsFilters
  /** When the counts were read (ISO timestamp): the view's "As of". */
  fetchedAt: string
  engineId?: string
}
