import { describe, expect, it } from 'vitest';
import { findByOperationId, loadCatalog } from '../catalog/catalog.js';
import { discoveryGroups, findCommands, listGroups } from './commands.js';
import { describeWorkflow, renderWorkflowDescribeText } from './describe-workflow.js';
import { findWorkflow, WORKFLOW_DOCS, WORKFLOW_GROUP, workflowDescription } from './workflow.js';
import { option } from './workflow-options.js';

const catalog = loadCatalog();
const UTILITIES = [
  'commands',
  'describe',
  'guide',
  'api',
  'ping',
  'config',
  'completion',
  'help',
  '__complete',
];

describe('WORKFLOW_DOCS', () => {
  it('has the six workflow commands in help order', () => {
    expect(WORKFLOW_DOCS.map((doc) => doc.name)).toEqual([
      'inspect',
      'wait',
      'advance',
      'retry',
      'deploy',
      'status',
    ]);
  });

  it('keeps every name distinct from groups, operationIds and utility commands', () => {
    const groups = catalog.groups.map((group) => group.name);
    const operationIds = catalog.operations.map((operation) => operation.operationId.toLowerCase());
    for (const name of [...WORKFLOW_DOCS.map((doc) => doc.name), WORKFLOW_GROUP.group]) {
      expect(groups, name).not.toContain(name);
      expect(operationIds, name).not.toContain(name.toLowerCase());
      expect(UTILITIES, name).not.toContain(name);
    }
  });

  it('calls only catalog operations, each once', () => {
    for (const doc of WORKFLOW_DOCS) {
      expect(new Set(doc.calls).size, doc.name).toBe(doc.calls.length);
      for (const operationId of doc.calls)
        expect(findByOperationId(catalog, operationId), operationId).toBeDefined();
    }
  });

  it('documents options with a flag, a syntax and a description; no global flag is reused', () => {
    for (const doc of WORKFLOW_DOCS) {
      for (const entry of doc.options) {
        expect(
          entry.syntax.startsWith(
            entry.kind === 'negated' ? `--no-${entry.flag}` : `--${entry.flag}`,
          ),
          entry.flag,
        ).toBe(true);
        expect(entry.description.length, entry.flag).toBeGreaterThan(10);
        expect(['timeout', 'output', 'yes', 'dry-run', 'engine'], entry.flag).not.toContain(
          entry.flag,
        );
      }
      expect(new Set(doc.options.map((entry) => entry.flag)).size, doc.name).toBe(
        doc.options.length,
      );
      expect(
        doc.examples.every((example) => example.startsWith(`operate ${doc.name}`)),
        doc.name,
      ).toBe(true);
    }
  });

  it('builds option docs from a kind', () => {
    expect(option('until', 'repeatable', 'desc', { valueName: '<c>', suggest: ['idle'] })).toEqual({
      flag: 'until',
      syntax: '--until <c>',
      kind: 'repeatable',
      valueName: '<c>',
      type: 'string',
      required: false,
      source: 'workflow',
      description: 'desc',
      suggest: ['idle'],
    });
    expect(option('variables', 'negated', 'd')).toMatchObject({
      syntax: '--no-variables',
      type: 'boolean',
    });
    expect(option('x', 'value', 'd')).toMatchObject({
      syntax: '--x <value>',
      valueName: '<value>',
    });
  });

  it('describes the requests and the effect in the help description', () => {
    const retry = findWorkflow('retry');
    expect(retry && workflowDescription(retry)).toMatch(
      /\n\nRequests: the selection, .*\.\n\nEffect: write; bulk with --process-definition-key alone \(requires --yes\); --dry-run sends the reads and previews the writes$/s,
    );
    expect(findWorkflow('nope')).toBeUndefined();
  });
});

describe('workflow commands in discovery', () => {
  it('adds the workflow group to the groups, sorted by name', () => {
    const groups = discoveryGroups(catalog);
    expect(groups).toHaveLength(listGroups(catalog).length + 1);
    expect(groups.at(-1)).toEqual(WORKFLOW_GROUP);
  });

  it('lists the workflow commands without their calls; searches and filters them first', () => {
    const workflow = findCommands(catalog, { group: 'workflow' });
    expect(workflow.map((row) => row.command)).toEqual([
      'inspect',
      'wait',
      'advance',
      'retry',
      'deploy',
      'status',
    ]);
    expect(workflow[0]).toMatchObject({
      aliases: [],
      effect: 'read',
      deprecated: false,
    });
    // describe lists the calls; the listing stays small
    expect('calls' in (workflow[0] ?? {})).toBe(false);
    expect('operationId' in (workflow[0] ?? {})).toBe(false);
    const incident = findCommands(catalog, { search: 'incident' }).map((row) => row.command);
    expect(incident.slice(0, 4)).toEqual(['inspect', 'wait', 'retry', 'status']);
    expect(incident).toContain('incident list');
    expect(
      findCommands(catalog, { effect: 'write', group: 'workflow' }).map((row) => row.command),
    ).toEqual(['advance', 'retry', 'deploy']);
    expect(findCommands(catalog, { group: 'task' }).every((row) => 'operationId' in row)).toBe(
      true,
    );
  });
});

describe('describeWorkflow', () => {
  it('describes a workflow command as JSON and text', () => {
    const doc = findWorkflow('deploy');
    if (doc === undefined) throw new Error('deploy');
    const view = describeWorkflow(doc, catalog);
    expect(view).toMatchObject({
      command: 'operate deploy <paths...>',
      workflow: true,
      effect: 'write',
      arguments: [
        {
          name: 'paths',
          required: true,
          variadic: true,
          description: 'BPMN, DMN and form files and directories to deploy',
        },
      ],
      calls: expect.arrayContaining([
        { operationId: 'createDeployment', command: 'deployment create' },
      ]),
    });
    expect(view.options.find((entry) => entry.flag === '--var <name=value>')).toMatchObject({
      type: 'variables',
      repeatable: true,
    });
    const text = renderWorkflowDescribeText(view);
    expect(text).toMatch(/^USAGE\n {2}operate deploy <paths\.\.\.> \[options\]\n\nDESCRIPTION\n/);
    expect(text).toContain('\n  Effect: write\n');
    expect(text).toContain('\nREQUESTS\n  getDeployments');
    const status = findWorkflow('status');
    const statusText = status && renderWorkflowDescribeText(describeWorkflow(status, catalog));
    expect(statusText).toContain('One of: warning, critical.');
    expect(statusText).not.toContain('\nARGUMENTS\n');
    const wait = findWorkflow('wait');
    expect(wait && describeWorkflow(wait, catalog).effectNote).toBe('write with --execute-jobs');
    expect(wait && renderWorkflowDescribeText(describeWorkflow(wait, catalog))).toContain(
      '  Effect: read; write with --execute-jobs\n',
    );
  });
});
