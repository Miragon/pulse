import type { FlowNodes } from '../bpmn/flow-nodes.js';
import type { ActiveTokens } from './active-tokens.js';
import type { ElementLabels } from './element-labels.js';

export interface MoveEnds {
  readonly from: string;
  readonly to: string;
  readonly closesIncident: boolean;
}

export class MoveEffects {
  constructor(
    private readonly nodes: FlowNodes,
    private readonly tokens: ActiveTokens,
    private readonly labels: ElementLabels,
  ) {}

  effects(move: MoveEnds): string[] {
    const from = this.labels.of(move.from);
    const to = this.labels.of(move.to);
    const cancels = move.closesIncident
      ? `Cancels ${from} and closes its incident.`
      : `Cancels ${from}.`;
    const starts =
      move.from === move.to
        ? `${to} starts again, with its listeners and input mappings.`
        : `Starts ${to}, with its listeners and input mappings, and runs on to the next wait.`;
    return [cancels, starts, ...this.scopeEffects(move)];
  }

  warnings(move: MoveEnds): string[] {
    const twice =
      move.from !== move.to && this.tokens.at(move.to) > 0
        ? [`${this.labels.of(move.to)} already holds a token; then it holds two.`]
        : [];
    return [...twice, ...this.joinWarnings(move), ...this.leftBehind(move)];
  }

  private scopeEffects(move: MoveEnds): string[] {
    const entered = this.subProcessesOnlyAround(move.to, move.from)
      .filter((scope) => this.tokens.runsOf(scope) === 0)
      .map((scope) => `Enters ${this.labels.of(scope)} without passing its start event.`);
    const ended = this.subProcessesOnlyAround(move.from, move.to)
      .filter((scope) => this.othersInside(scope, move.from).length === 0)
      .map((scope) => `Ends ${this.labels.of(scope)} without completing it.`);
    return [...entered, ...ended];
  }

  private joinWarnings(move: MoveEnds): string[] {
    if (move.from === move.to || this.nodes.reachesAlongBranch(move.from, move.to)) {
      return [];
    }
    const before = this.nodes.joinsAfter(move.from);
    const after = this.nodes.joinsAfter(move.to);
    const reached = after
      .filter((join) => !before.includes(join))
      .map(
        (join) => `The token reaches ${this.labels.of(join)}, which may wait for its other paths.`,
      );
    const lost = before
      .filter((join) => !after.includes(join))
      .map(
        (join) =>
          `${this.labels.of(join)} no longer gets the token from ${this.labels.of(move.from)}; its other paths wait there.`,
      );
    return [...reached, ...lost];
  }

  private leftBehind(move: MoveEnds): string[] {
    return this.subProcessesOnlyAround(move.from, move.to)
      .filter((scope) => this.othersInside(scope, move.from).length > 0)
      .map((scope) => `${this.labels.of(scope)} keeps its other tokens; only this one leaves.`);
  }

  private subProcessesOnlyAround(inner: string, outer: string): string[] {
    const outside = new Set([outer, ...this.nodes.scopesAround(outer)]);
    return this.nodes
      .scopesAround(inner)
      .filter((scope) => !outside.has(scope) && this.nodes.kindOf(scope) !== undefined);
  }

  private othersInside(scope: string, except: string): string[] {
    const around = new Set([except, ...this.nodes.scopesAround(except)]);
    return this.tokens
      .holders()
      .filter((holder) => !around.has(holder) && this.nodes.scopesAround(holder).includes(scope));
  }
}
