import { BpmnProcessId, DefinitionId, InstanceId } from '../../src/contract/index.js';
import { FakeEngine, FakeWorld, PatchedRuntime } from '../../src/contract/fake/index.js';
import { describe, expect, test } from 'vitest';
import { DefinitionNodes } from '../../src/core/explorer/definition-nodes.js';
import { ElementNames } from '../../src/core/bpmn/element-names.js';
import { InstancePanel } from '../../src/core/panels/instance-panel.js';
import { DefinitionViewBuilder } from '../../src/core/views/definition-view-builder.js';
import { panelFixture } from './support/panel-fixture.js';

const NOW = new Date('2026-10-21T09:00:00Z');

describe('labels without optional facts', () => {
  test('a definition without a name is labelled by its process id and idle without instances', async () => {
    const { state } = FakeWorld.seed();
    const runtime = new PatchedRuntime(new FakeEngine(state), {
      listDefinitions: () =>
        Promise.resolve([
          {
            latest: { id: DefinitionId('p:1'), bpmnProcessId: BpmnProcessId('p'), version: 1 },
            running: 0,
            withIncident: 0,
          },
        ]),
    });
    expect(await new DefinitionNodes(runtime).list()).toMatchObject([
      { label: 'p', description: 'idle · latest v1' },
    ]);
  });

  test('element names skip unnamed elements and keep the first name of an id', () => {
    const names = ElementNames.of(
      '<task id="a"/><task id="b" name=" "/><task id="c" name="One"/><task id="c" name="Two"/>',
    );
    expect([...names.entries()]).toEqual([['c', 'One']]);
  });

  test('a definition view without versions is empty but valid', () => {
    const view = new DefinitionViewBuilder({
      engine: { name: 'local', environment: 'local', host: 'localhost' },
      asOf: NOW,
      versions: [],
      selectedDefinitionId: DefinitionId('p:1'),
      diagramXml: '',
      statistics: [],
      calledProcesses: [],
      instances: [
        {
          id: InstanceId('i'),
          definition: { id: DefinitionId('p:1'), bpmnProcessId: BpmnProcessId('p'), version: 1 },
          state: 'suspended',
          hasIncident: false,
        },
      ],
      hasMoreInstances: false,
      filter: { scope: 'running' },
      scopeCounts: { running: 1, withIncident: 0, ended: 0, all: 1 },
    }).build();
    expect(view).toMatchObject({ processName: '', bpmnProcessId: '', notices: [] });
    expect(view.instances).toEqual([
      { id: 'i', shortId: 'i', state: 'Suspended', hasIncident: false },
    ]);
  });
});

describe('the instance panel while refreshing', () => {
  test('keeps showing the last view and marks it as refreshing', async () => {
    const fixture = panelFixture();
    const panel = new InstancePanel(fixture.context, fixture.world.instanceIds['ORD-1001']);
    await panel.handle({ type: 'ready' });

    await panel.handle({ type: 'refresh' });

    const [refreshing, ready] = fixture.states.slice(-2);
    expect(refreshing).toMatchObject({ status: 'ready', refreshing: true });
    expect(ready).toMatchObject({ status: 'ready', refreshing: false });
  });
});
