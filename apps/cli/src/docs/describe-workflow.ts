/**
 * `operate describe <workflow-command>` (design §17.3): usage, description, effect, arguments,
 * options, the operations it may call and examples, as a JSON view and as readable text. Pure.
 */

import { findByOperationId } from '../catalog/catalog.js';
import type { Catalog, Effect } from '../catalog/types.js';
import { compact } from '../util.js';
import { columns, paragraphLines, wrap, wrapCommand } from './text.js';
import type { WorkflowDoc } from './workflow.js';

interface WorkflowOptionView {
  readonly flag: string;
  readonly type: string;
  readonly required: boolean;
  readonly enum?: readonly string[];
  readonly repeatable?: boolean;
  readonly description: string;
}

interface WorkflowArgumentView {
  readonly name: string;
  readonly required: boolean;
  readonly variadic?: true;
  readonly description: string;
}

export interface WorkflowDescribeView {
  readonly command: string;
  readonly workflow: true;
  readonly summary: string;
  readonly description: string;
  readonly effect: Effect;
  readonly effectNote?: string;
  readonly arguments: readonly WorkflowArgumentView[];
  readonly options: readonly WorkflowOptionView[];
  /** The catalog operations it may send, with their generated command. */
  readonly calls: readonly { readonly operationId: string; readonly command: string }[];
  readonly examples: readonly string[];
}

export function describeWorkflow(doc: WorkflowDoc, catalog: Catalog): WorkflowDescribeView {
  return {
    command: doc.usage.replace(' [options]', ''),
    workflow: true,
    summary: doc.summary,
    description: doc.description,
    effect: doc.effect,
    ...compact({ effectNote: doc.effectNote }),
    arguments: doc.arguments.map((argument) => ({
      name: argument.name,
      required: argument.required,
      ...compact({ variadic: argument.variadic ? (true as const) : undefined }),
      description: argument.description,
    })),
    options: doc.options.map((option) => ({
      flag: option.syntax,
      type: option.type,
      required: option.required,
      ...compact({
        enum: option.enum,
        repeatable: option.kind === 'repeatable' ? true : undefined,
      }),
      description: option.description,
    })),
    calls: doc.calls.map((operationId) => {
      const operation = findByOperationId(catalog, operationId);
      return {
        operationId,
        command: operation === undefined ? '' : `${operation.group} ${operation.name}`,
      };
    }),
    examples: doc.examples,
  };
}

function section(title: string, lines: readonly string[]): string[] {
  return lines.length === 0 ? [] : ['', title, ...lines];
}

/** `<name>`, `[name]` or `<name...>`, as in the usage line. */
function argumentTerm(argument: WorkflowArgumentView): string {
  const name = `${argument.name}${argument.variadic === true ? '...' : ''}`;
  return argument.required ? `<${name}>` : `[${name}]`;
}

function optionText(option: WorkflowOptionView): string {
  return option.enum === undefined
    ? option.description
    : `${option.description}. One of: ${option.enum.join(', ')}.`;
}

/** Human readable `operate describe <workflow-command>`, with a trailing newline. */
export function renderWorkflowDescribeText(view: WorkflowDescribeView): string {
  const effect = view.effectNote === undefined ? view.effect : `${view.effect}; ${view.effectNote}`;
  const lines = [
    'USAGE',
    ...wrapCommand(`${view.command} [options]`, '  '),
    ...section('DESCRIPTION', [
      ...wrap(view.summary, '  '),
      `  Effect: ${effect}`,
      '',
      ...paragraphLines(view.description),
    ]),
    ...section(
      'ARGUMENTS',
      columns(view.arguments.map((arg) => [argumentTerm(arg), arg.description])),
    ),
    ...section('OPTIONS', columns(view.options.map((option) => [option.flag, optionText(option)]))),
    ...section(
      'REQUESTS',
      columns(view.calls.map((call) => [call.operationId, `operate ${call.command}`])),
    ),
    ...section(
      'EXAMPLES',
      view.examples.flatMap((example) => wrapCommand(example, '  ')),
    ),
  ];
  return `${lines.join('\n')}\n`;
}
