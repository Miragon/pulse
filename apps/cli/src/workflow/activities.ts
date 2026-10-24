/**
 * The activity instance trees of the instances of a tree as one index: which activity instance an
 * execution belongs to, which transition instance (async continuation) waits on it, and the leaf
 * activity instances. Pure.
 */

import { compareText, field, type Rec, records, str } from './records.js';

export interface ActivityNode {
  readonly id: string;
  readonly activityId: string;
  readonly activityName?: string;
  readonly activityType?: string;
  readonly processInstanceId: string;
  readonly depth: number;
  /** The process instance itself (root of its activity instance tree). */
  readonly root: boolean;
  /** No child activity or transition instances. */
  readonly leaf: boolean;
  readonly transition: boolean;
  readonly executionIds: readonly string[];
}

export interface ActivityIndex {
  readonly nodes: readonly ActivityNode[];
  byId(id: string | undefined): ActivityNode | undefined;
  /** The activity instance of an execution: one of `activityId` if possible, else the deepest. */
  forExecution(executionId: string | undefined, activityId?: string): ActivityNode | undefined;
  /** The transition instance (async continuation) of an execution. */
  transition(executionId: string | undefined, activityId?: string): ActivityNode | undefined;
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? (value as unknown[]).filter((item): item is string => typeof item === 'string')
    : [];
}

interface Position {
  readonly processInstanceId: string;
  readonly depth: number;
}

function node(
  instance: Rec,
  position: Position,
  flags: Pick<ActivityNode, 'root' | 'leaf' | 'transition'>,
  executionIds: string[],
): ActivityNode {
  const name = str(instance, 'activityName') ?? str(instance, 'name');
  const type = str(instance, 'activityType');
  return {
    id: field(instance, 'id'),
    activityId: field(instance, 'activityId'),
    ...(name === undefined ? {} : { activityName: name }),
    ...(type === undefined ? {} : { activityType: type }),
    ...position,
    ...flags,
    executionIds,
  };
}

function walk(instance: Rec, position: Position, nodes: ActivityNode[]): void {
  const children = records(instance.childActivityInstances);
  const transitions = records(instance.childTransitionInstances);
  const leaf = children.length === 0 && transitions.length === 0;
  const flags = { root: position.depth === 0, leaf, transition: false };
  nodes.push(node(instance, position, flags, strings(instance.executionIds)));
  const below = { ...position, depth: position.depth + 1 };
  for (const child of children) walk(child, below, nodes);
  for (const transition of transitions) {
    const executionId = str(transition, 'executionId');
    const transitionFlags = { root: false, leaf: false, transition: true };
    nodes.push(
      node(transition, below, transitionFlags, executionId === undefined ? [] : [executionId]),
    );
  }
}

/** Deepest first, then by id: a deterministic choice among candidates. */
function best(candidates: readonly ActivityNode[], activityId: string | undefined) {
  const matching = candidates.filter((candidate) => candidate.activityId === activityId);
  return (matching.length > 0 ? matching : candidates).toSorted(
    (left, right) => right.depth - left.depth || compareText(left.id, right.id),
  )[0];
}

/** Indexes the activity instance trees (ActivityInstanceDto) of the instances of a tree. */
export function indexActivities(trees: readonly Rec[]): ActivityIndex {
  const nodes: ActivityNode[] = [];
  for (const tree of trees) {
    const processInstanceId = str(tree, 'processInstanceId') ?? field(tree, 'id');
    walk(tree, { processInstanceId, depth: 0 }, nodes);
  }
  const containing = (executionId: string | undefined, transition: boolean) =>
    executionId === undefined
      ? []
      : nodes.filter(
          (candidate) =>
            candidate.transition === transition && candidate.executionIds.includes(executionId),
        );
  return {
    nodes,
    byId: (id) => (id === undefined ? undefined : nodes.find((candidate) => candidate.id === id)),
    forExecution: (executionId, activityId) => best(containing(executionId, false), activityId),
    transition: (executionId, activityId) => best(containing(executionId, true), activityId),
  };
}
