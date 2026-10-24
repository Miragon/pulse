import { describe, expect, it } from 'vitest';
import { portOf } from '../../test/support/engine-port.js';
import { fakeServer, json } from '../../test/support/fake-fetch.js';
import { resourceViews } from './deploy-view.js';

const resources = (...names: string[]) => names.map((name) => ({ file: `/x/${name}`, name }));

const FACTS = { name: 'operate', source: 'operate' };

/** Every version of a resource name engine-wide; `own` is a deployment of this name and source. */
function lookups() {
  return fakeServer()
    .on('GET', '/deployment', json([{ id: 'own' }, { id: 'dep-1' }]))
    .on('GET', '/process-definition', (request) =>
      json([
        {
          id: 'p:9:x',
          key: `latest-${request.query.get('resourceName') ?? ''}`,
          version: 9,
          deploymentId: 'own',
        },
      ]),
    )
    .on(
      'GET',
      '/decision-definition',
      json([{ id: 'd:4:x', key: 'z-decision', version: 4, deploymentId: 'own' }]),
    )
    .on(
      'GET',
      '/decision-requirements-definition',
      json([{ id: 'r:2:x', key: 'a-drd', version: 2, name: 'DRD', deploymentId: 'dep-1' }]),
    );
}

describe('resourceViews', () => {
  it('reports the definitions of the deployed* maps per resource, sorted by type and key', async () => {
    const server = lookups().on(
      'GET',
      '/deployment/dep-2/resources',
      json([{ name: 'shared.bpmn' }, { name: 'form.form' }, { id: 'no-name' }]),
    );
    const deployment = {
      id: 'dep-2',
      deployedProcessDefinitions: {
        b: { id: 'b:1:x', key: 'b', version: 1, resource: 'shared.bpmn' },
        a: { id: 'a:1:x', key: 'a', version: 1, name: 'A', resource: 'shared.bpmn' },
        none: {},
      },
      deployedDecisionDefinitions: {
        d: { id: 'd:1:x', key: 'd', version: 1, resource: 'rules.dmn' },
      },
      deployedDecisionRequirementsDefinitions: {
        r: { id: 'r:1:x', key: 'r', version: 1, resource: 'rules.dmn' },
      },
      deployedCaseDefinitions: { c: { id: 'c', key: 'c', resource: 'shared.bpmn' } },
    };
    const result = await resourceViews(portOf(server.fetch), {
      deployment,
      changed: true,
      resources: resources('shared.bpmn', 'rules.dmn', 'form.form', 'old.bpmn'),
      ...FACTS,
      tenantId: 't1',
    });
    expect(result).toEqual({
      deploymentId: 'dep-2',
      name: '',
      changed: true,
      deploymentTime: '',
      resources: [
        {
          resource: 'shared.bpmn',
          status: 'deployed',
          definitions: [
            { type: 'process', key: 'a', version: 1, id: 'a:1:x', name: 'A' },
            { type: 'process', key: 'b', version: 1, id: 'b:1:x' },
          ],
        },
        {
          resource: 'rules.dmn',
          status: 'deployed',
          definitions: [
            { type: 'decision', key: 'd', version: 1, id: 'd:1:x' },
            { type: 'drd', key: 'r', version: 1, id: 'r:1:x' },
          ],
        },
        { resource: 'form.form', status: 'deployed', definitions: [] },
        {
          resource: 'old.bpmn',
          status: 'unchanged',
          definitions: [{ type: 'process', key: 'latest-old.bpmn', version: 9, id: 'p:9:x' }],
        },
      ],
    });
    expect(
      server.requests.map((request) => [request.path, Object.fromEntries(request.query)]),
    ).toEqual([
      ['/deployment/dep-2/resources', {}],
      [
        '/deployment',
        {
          name: 'operate',
          source: 'operate',
          tenantIdIn: 't1',
          firstResult: '0',
          maxResults: '500',
        },
      ],
      [
        '/process-definition',
        { resourceName: 'old.bpmn', tenantIdIn: 't1', firstResult: '0', maxResults: '500' },
      ],
    ]);
  });

  it('looks up the latest decisions and DRDs of an unchanged DMN, and nothing for other files', async () => {
    const server = lookups();
    const result = await resourceViews(portOf(server.fetch), {
      deployment: { id: 'dep-1', name: 'n', deploymentTime: 't', deployedProcessDefinitions: [] },
      changed: false,
      resources: resources('rules.dmn', 'form.form'),
      ...FACTS,
    });
    expect(result).toEqual({
      deploymentId: 'dep-1',
      name: 'n',
      changed: false,
      deploymentTime: 't',
      resources: [
        {
          resource: 'rules.dmn',
          status: 'unchanged',
          definitions: [
            { type: 'decision', key: 'z-decision', version: 4, id: 'd:4:x' },
            { type: 'drd', key: 'a-drd', version: 2, id: 'r:2:x', name: 'DRD' },
          ],
        },
        { resource: 'form.form', status: 'unchanged', definitions: [] },
      ],
    });
    expect(server.requests.map((request) => request.path).sort()).toEqual([
      '/decision-definition',
      '/decision-requirements-definition',
      '/deployment',
    ]);
    const decisions = server.requests.find((request) => request.path === '/decision-definition');
    expect(decisions?.query.get('resourceName')).toBe('rules.dmn');
  });

  it("ignores another deployment's resource of the same name and takes the latest own version per key", async () => {
    // another team deployed other/workflow.bpmn (resource name workflow.bpmn) as team-b
    const server = fakeServer()
      .on('GET', '/deployment', json([{ id: 'mine-1' }, { id: 'mine-2' }]))
      .on(
        'GET',
        '/process-definition',
        json([
          { id: 'other:1:x', key: 'other-process', version: 1, deploymentId: 'team-b' },
          { id: 'parent:1:x', key: 'workflow-parent', version: 1, deploymentId: 'mine-1' },
          { id: 'parent:3:x', key: 'workflow-parent', version: 3, deploymentId: 'mine-2' },
          { id: 'parent:2:x', key: 'workflow-parent', version: 2, deploymentId: 'mine-1' },
          { id: 'parent:4:x', key: 'workflow-parent', version: 4, deploymentId: 'team-b' },
        ]),
      );
    const result = await resourceViews(portOf(server.fetch), {
      deployment: { id: 'mine-2' },
      changed: false,
      resources: resources('workflow.bpmn'),
      ...FACTS,
    });
    expect(result.resources).toEqual([
      {
        resource: 'workflow.bpmn',
        status: 'unchanged',
        definitions: [{ type: 'process', key: 'workflow-parent', version: 3, id: 'parent:3:x' }],
      },
    ]);
  });

  it('sends no deployment list when nothing is unchanged', async () => {
    const server = fakeServer().on('GET', '/deployment/dep-3/resources', json([]));
    const result = await resourceViews(portOf(server.fetch), {
      deployment: {
        id: 'dep-3',
        deployedProcessDefinitions: {
          a: { id: 'a:1:x', key: 'a', version: 1, resource: 'a.bpmn' },
        },
      },
      changed: true,
      resources: resources('a.bpmn'),
      ...FACTS,
    });
    expect(result.resources[0]?.status).toBe('deployed');
    expect(server.requests.map((request) => request.path)).toEqual(['/deployment/dep-3/resources']);
  });
});
