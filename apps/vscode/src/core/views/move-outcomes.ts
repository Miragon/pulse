import type { InstanceView, MoveOption, MoveTarget, Notice, WaitRow } from '../protocol/index.js';

export class MoveOutcomes {
  static after(
    option: MoveOption,
    target: MoveTarget,
    before: InstanceView,
    view: InstanceView,
  ): Notice {
    if (view === before) {
      return MoveOutcomes.notice(
        'Moved. Pulse could not read the instance again; refresh to see where the token waits.',
      );
    }
    const failure = view.incidents.find((row) => row.elementId === target.elementId);
    if (failure !== undefined) {
      return {
        tone: 'danger',
        title: `Moved to ${target.label}; it failed there.`,
        detail: failure.rootCause ?? failure.message,
        actions: [],
      };
    }
    if (view.instance.state !== 'Running') {
      return MoveOutcomes.notice(`Moved to ${target.label}. The instance then ran to its end.`);
    }
    const isOld = (row: WaitRow) =>
      before.waitStates.some((old) => old.elementId === row.elementId && old.since === row.since);
    const sourceKept = view.waitStates.some(
      (row) => row.elementId === option.fromElementId && isOld(row),
    );
    if (option.fromElementId !== target.elementId && sourceKept) {
      return {
        tone: 'warning',
        title: `The engine accepted the move, but a token still waits at ${option.fromLabel}.`,
        detail: 'Refresh to check again.',
        actions: [],
      };
    }
    if (view.waitStates.some((row) => row.elementId === target.elementId)) {
      return MoveOutcomes.notice(`Moved. Now waiting at ${target.label}.`);
    }
    const next = view.waitStates.find((row) => !isOld(row));
    return MoveOutcomes.notice(
      next === undefined
        ? `Moved to ${target.label}.`
        : `Moved to ${target.label}; now waiting at ${next.elementName ?? next.elementId}.`,
    );
  }

  private static notice(title: string): Notice {
    return { tone: 'info', title, actions: [] };
  }
}
