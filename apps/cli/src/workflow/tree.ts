/**
 * The active instance tree below a process instance (design §17.2.5): breadth first over
 * `GET /process-instance?superProcessInstance=<id>`, one round per level. Works without history
 * and on every engine (`rootProcessInstanceId` would include siblings and carries no parent edge).
 */

import type { EnginePort } from '../engine-port/engine-port.js';
import { compact, mapLimit } from '../util.js';
import { PARALLEL } from './engine.js';
import { definitionKeyOf, field, type Rec, str, yes } from './records.js';
import type { TreeNode } from './types.js';

export interface InstanceTree {
  /** The selected instance first, then level by level. */
  readonly nodes: readonly TreeNode[];
  /** True when the tree was cut at depth 10 or 100 instances. */
  readonly truncated: boolean;
}

const MAX_DEPTH = 10;
const MAX_INSTANCES = 100;

/** A tree node of a ProcessInstanceDto, undefined without an id. */
export function treeNode(
  dto: Rec,
  parentId: string | undefined,
  depth: number,
): TreeNode | undefined {
  const id = str(dto, 'id');
  if (id === undefined) return undefined;
  const definitionId = field(dto, 'definitionId');
  return {
    id,
    ...compact({ parentId }),
    definitionId,
    ...compact({
      definitionKey: str(dto, 'definitionKey') ?? definitionKeyOf(definitionId),
      businessKey: str(dto, 'businessKey'),
    }),
    suspended: yes(dto, 'suspended'),
    depth,
  };
}

interface Level {
  readonly children: TreeNode[];
  readonly truncated: boolean;
}

async function nextLevel(port: EnginePort, level: readonly TreeNode[], depth: number) {
  const pages = await mapLimit(level, PARALLEL, async (node): Promise<Level> => {
    const page = await port.list(
      'getProcessInstances',
      { superProcessInstance: node.id },
      MAX_INSTANCES,
    );
    const children = page.items.flatMap((dto) => treeNode(dto, node.id, depth) ?? []);
    return { children, truncated: page.truncated };
  });
  return {
    children: pages.flatMap((page) => page.children),
    truncated: pages.some((page) => page.truncated),
  };
}

/** The active tree of `root` (a ProcessInstanceDto): at most depth 10 and 100 instances. */
export async function activeTree(port: EnginePort, root: Rec): Promise<InstanceTree> {
  const first = treeNode(root, undefined, 0);
  if (first === undefined) return { nodes: [], truncated: false };
  const nodes: TreeNode[] = [first];
  let level: TreeNode[] = [first];
  let truncated = false;
  for (let depth = 1; level.length > 0; depth++) {
    const next = await nextLevel(port, level, depth);
    truncated ||= next.truncated;
    const room = MAX_INSTANCES - nodes.length;
    if (next.children.length > 0 && (depth > MAX_DEPTH || next.children.length > room)) {
      nodes.push(...next.children.slice(0, depth > MAX_DEPTH ? 0 : room));
      return { nodes, truncated: true };
    }
    nodes.push(...next.children);
    level = next.children;
  }
  return { nodes, truncated };
}
