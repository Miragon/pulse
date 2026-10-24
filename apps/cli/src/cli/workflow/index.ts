/**
 * The workflow commands (design §17): top-level commands that combine catalog operations,
 * registered eagerly in the order of the root help heading "Workflow commands:".
 */

import type { Command } from 'commander';
import { WORKFLOW_DOCS } from '../../docs/workflow.js';
import type { CliContext } from '../context.js';
import { runAdvance, runDeploy, runInspect, runRetry, runStatus, runWait } from './actions.js';
import { registerWorkflow, type WorkflowAction } from './register.js';

const ACTIONS: Readonly<Record<string, WorkflowAction>> = {
  inspect: runInspect,
  wait: runWait,
  advance: runAdvance,
  retry: runRetry,
  deploy: runDeploy,
  status: runStatus,
};

/** Names of the workflow commands, in help order. */
export const WORKFLOW_COMMANDS: readonly string[] = WORKFLOW_DOCS.map((doc) => doc.name);

export function registerWorkflowCommands(program: Command, context: CliContext): void {
  for (const doc of WORKFLOW_DOCS) {
    const action = ACTIONS[doc.name];
    if (action !== undefined) registerWorkflow(program, doc, context, action);
  }
}
