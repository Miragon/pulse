import type {
  InstanceListData,
  InstanceScopeCode,
  ScopeCountsData,
} from "../format/instance-list-data.js"
import type { CallLinkKind, InstanceStateCode } from "../format/instance-screen-data.js"
import type {
  ProcessNoticeCode,
  ProcessReadCode,
  ProcessScreenData,
} from "../format/process-screen-data.js"

type VersionFigure = readonly [number, number, number]

type BadgeFigure = readonly [string, number, number, number]

type CallFigure = readonly [string, CallLinkKind, string | null, number | null]

type NoticeFigure = readonly [ProcessNoticeCode, number, number, number]

type RowFigure = readonly [string | null, InstanceStateCode, boolean]

export interface ProcessFiguresData {
  readonly bpmnProcessId: string
  readonly selected: number | null
  readonly versions: readonly VersionFigure[]
  readonly badges: readonly BadgeFigure[]
  readonly calls: readonly CallFigure[]
  readonly notices: readonly NoticeFigure[]
  readonly unread: readonly ProcessReadCode[]
}

type CountFigures = Readonly<Record<InstanceScopeCode, number>> & {
  readonly atLeast: readonly InstanceScopeCode[]
}

export interface InstanceListFiguresData {
  readonly rows: readonly RowFigure[]
  readonly more: boolean
  readonly counts: CountFigures | null
}

export class ProcessFigures {
  static of(data: ProcessScreenData): ProcessFiguresData {
    return {
      bpmnProcessId: data.bpmnProcessId,
      selected: data.selected?.version ?? null,
      versions: data.versions.map(({ definition, running, withIncident }) => [
        definition.version,
        running,
        withIncident,
      ]),
      badges: ProcessFigures.sorted(
        data.badges.map(({ elementId, running, incidents, incidentsInCalledInstances }) => [
          elementId,
          running,
          incidents,
          incidentsInCalledInstances,
        ]),
      ),
      calls: ProcessFigures.sorted(data.calls.map((link) => ProcessFigures.call(link))),
      notices: data.notices.map(({ code, running, withIncident, show }) => [
        code,
        running,
        withIncident,
        show.version,
      ]),
      unread: data.unread,
    }
  }

  static list(data: InstanceListData): InstanceListFiguresData {
    return {
      rows: ProcessFigures.sorted(
        data.rows.map(({ businessKey, state, hasIncident }) => [
          businessKey ?? null,
          state,
          hasIncident,
        ]),
      ),
      more: data.next !== null,
      counts: data.counts === null ? null : ProcessFigures.counts(data.counts),
    }
  }

  private static counts(counts: ScopeCountsData): CountFigures {
    const { running, withIncident, ended, all, atLeast = [] } = counts
    return { running, withIncident, ended, all, atLeast }
  }

  private static call(link: ProcessScreenData["calls"][number]): CallFigure {
    switch (link.kind) {
      case "definition":
        return [link.elementId, link.kind, link.definition.bpmnProcessId, link.definition.version]
      case "missing":
        return [link.elementId, link.kind, link.bpmnProcessId, null]
      case "instances":
        return [link.elementId, link.kind, null, null]
    }
  }

  private static sorted<Figure extends readonly unknown[]>(figures: Figure[]): Figure[] {
    return figures.sort((left, right) => {
      const a = JSON.stringify(left)
      const b = JSON.stringify(right)
      return a < b ? -1 : Number(a > b)
    })
  }
}
