import type {
  CalledInstanceRefData,
  CallLinkKind,
  HeadlineCode,
  InstanceScreenData,
  InstanceStateCode,
  MarkerKindCode,
  PathStateCode,
} from "../format/instance-screen-data.js"

type Place = readonly [string, string | null]

type CalledFigure = readonly [string, InstanceStateCode, boolean]

type CallFigure = readonly [string, CallLinkKind, readonly CalledFigure[]]

export interface InstanceFiguresData {
  readonly state: InstanceStateCode
  readonly hasIncident: boolean
  readonly caller: string | null
  readonly headline: HeadlineCode | null
  readonly markers: readonly (readonly [string, MarkerKindCode])[]
  readonly calls: readonly CallFigure[]
  readonly incidents: readonly Place[]
  readonly waits: readonly Place[]
  readonly path: readonly (readonly [string, Exclude<PathStateCode, "active">])[]
}

export class InstanceFigures {
  static of(data: InstanceScreenData): InstanceFiguresData {
    return {
      state: data.instance.state,
      hasIncident: data.instance.hasIncident,
      caller: data.caller?.found?.definition.bpmnProcessId ?? null,
      headline: data.headline?.code ?? null,
      markers: InstanceFigures.sorted(data.markers.map(({ elementId, kind }) => [elementId, kind])),
      calls: InstanceFigures.sorted(data.calls.map((link) => InstanceFigures.call(link))),
      incidents: InstanceFigures.sorted(
        data.incidents.map(({ elementId, liesIn }) => InstanceFigures.place(elementId, liesIn)),
      ),
      waits: InstanceFigures.sorted(
        data.waits.map(({ elementId, liesIn }) => InstanceFigures.place(elementId, liesIn)),
      ),
      path: InstanceFigures.sorted(
        data.path.flatMap(({ elementId, state }) =>
          state === "active" ? [] : [[elementId, state] as const],
        ),
      ),
    }
  }

  private static call(link: InstanceScreenData["calls"][number]): CallFigure {
    const instances =
      link.kind === "instances"
        ? link.instances.map(({ bpmnProcessId, state, withIncident }): CalledFigure => [
            bpmnProcessId,
            state,
            withIncident,
          ])
        : []
    return [link.elementId, link.kind, instances]
  }

  private static place(elementId: string, liesIn: CalledInstanceRefData | null): Place {
    return [elementId, liesIn?.bpmnProcessId ?? null]
  }

  private static sorted<Figure extends readonly unknown[]>(figures: Figure[]): Figure[] {
    return figures.sort((left, right) => {
      const a = JSON.stringify(left)
      const b = JSON.stringify(right)
      return a < b ? -1 : Number(a > b)
    })
  }
}
