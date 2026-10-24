import { PatchedRuntime } from '../../src/contract/fake/index.js';
import {
  BpmnProcessId,
  type InstanceDetail,
  type InstanceSummary,
  type Page,
  type ProcessRuntime,
} from '../../src/contract/index.js';
import { describe, expect, test } from 'vitest';
import { DefinitionPanel } from '../../src/core/panels/definition-panel.js';
import { InstancePanel } from '../../src/core/panels/instance-panel.js';
import type { DefinitionView, PanelState } from '../../src/core/protocol/index.js';
import { panelFixture } from './support/panel-fixture.js';

const ORDER = BpmnProcessId('pulse-order');

interface Gate {
  readonly opened: Promise<void>;
  open(): void;
}

function gate(): Gate {
  let open = (): void => undefined;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { opened, open };
}

function lastReady(states: readonly PanelState[]): DefinitionView {
  const ready = states.filter((state) => state.status === 'ready' && !state.refreshing).at(-1);
  if (ready?.status !== 'ready' || ready.view.kind !== 'definition') {
    throw new Error('no ready definition view');
  }
  return ready.view;
}

describe('overlapping loads', () => {
  test('a slow older instance load cannot overwrite the newer view', async () => {
    const slow = gate();
    let calls = 0;
    const fixture = panelFixture(
      (runtime): ProcessRuntime =>
        new PatchedRuntime(runtime, {
          getInstanceDetail: async (instanceId): Promise<InstanceDetail | undefined> => {
            calls += 1;
            if (calls === 2) {
              await slow.opened;
              return undefined;
            }
            return runtime.getInstanceDetail(instanceId);
          },
        }),
    );
    const panel = new InstancePanel(fixture.context, fixture.world.instanceIds['ORD-1001']);
    await panel.handle({ type: 'ready' });

    const older = panel.handle({ type: 'refresh' });
    await panel.handle({ type: 'refresh' });
    slow.open();
    await older;

    expect(fixture.lastState()).toMatchObject({ status: 'ready', refreshing: false });
  });

  test('loading more while a filter change is in flight keeps the filter consistent', async () => {
    const slowFilter = gate();
    const fixture = panelFixture(
      (runtime): ProcessRuntime =>
        new PatchedRuntime(runtime, {
          searchInstances: async (filter, page): Promise<Page<InstanceSummary>> => {
            if (filter.withIncident === true) {
              await slowFilter.opened;
            }
            return runtime.searchInstances(filter, { ...page, limit: 1 });
          },
        }),
    );
    const definitionId = fixture.world.definitionIds['order@1'];
    const panel = new DefinitionPanel(fixture.context, { bpmnProcessId: ORDER, definitionId });
    await panel.handle({ type: 'ready' });

    const filtering = panel.handle({ type: 'filterInstances', filter: { scope: 'withIncident' } });
    await panel.handle({ type: 'loadMoreInstances' });
    slowFilter.open();
    await filtering;

    const view = lastReady(fixture.states);
    expect(view.filter.scope).toBe('withIncident');
    expect(view.instances.map((row) => row.businessKey)).toEqual(['ORD-1002']);
  });

  test('a failed refresh that started earlier does not replace a newer view', async () => {
    const slow = gate();
    let calls = 0;
    const fixture = panelFixture(
      (runtime): ProcessRuntime =>
        new PatchedRuntime(runtime, {
          listVersions: async (bpmnProcessId) => {
            calls += 1;
            if (calls === 2) {
              await slow.opened;
              return [];
            }
            return runtime.listVersions(bpmnProcessId);
          },
        }),
    );
    const panel = new DefinitionPanel(fixture.context, { bpmnProcessId: ORDER });
    await panel.handle({ type: 'ready' });

    const older = panel.handle({ type: 'refresh' });
    await panel.handle({ type: 'refresh' });
    slow.open();
    await older;

    expect(fixture.lastState()).toMatchObject({ status: 'ready', refreshing: false });
  });
});
