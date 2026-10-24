import { PatchedRuntime } from '../../src/contract/fake/index.js';
import { BpmnProcessId, RuntimeError } from '../../src/contract/index.js';
import { describe, expect, test } from 'vitest';
import { DefinitionPanel } from '../../src/core/panels/definition-panel.js';
import type { DefinitionView, PanelState } from '../../src/core/protocol/index.js';
import { panelFixture } from './support/panel-fixture.js';

const ORDER = BpmnProcessId('pulse-order');

function readyView(state: PanelState): DefinitionView {
  if (state.status !== 'ready' || state.view.kind !== 'definition') {
    throw new Error(`expected a ready definition view, got ${state.status}`);
  }
  return state.view;
}

describe('the definition panel', () => {
  test('shows the latest version first, with its badges and running instances', async () => {
    const fixture = panelFixture();
    const panel = new DefinitionPanel(fixture.context, { bpmnProcessId: ORDER });

    await panel.handle({ type: 'ready' });

    const view = readyView(fixture.lastState());
    expect(fixture.states[0]?.status).toBe('loading');
    expect(view.versions.map((version) => version.version)).toEqual([2, 1]);
    expect(view.selectedDefinitionId).toBe(fixture.world.definitionIds['order@2']);
    expect(view.badges).toEqual([
      {
        elementId: 'Activity_ReviewOrder',
        running: 1,
        incidents: 0,
        incidentsInCalledInstances: 0,
      },
    ]);
    expect(view.instances.map((row) => row.businessKey)).toEqual(['ORD-2001']);
    expect(view.diagramXml).toContain('Activity_ReviewOrder');
    expect(view.asOf).toBe('2026-10-21T09:00:00.000Z');
  });

  test('stays within seven engine calls for the first load, three of them counts', async () => {
    const fixture = panelFixture();
    const panel = new DefinitionPanel(fixture.context, { bpmnProcessId: ORDER });

    await panel.handle({ type: 'ready' });

    expect(fixture.calls.length).toBeLessThanOrEqual(7);
    expect(fixture.calls.filter((call) => call === 'countInstances')).toHaveLength(3);
  });

  test('counts every scope of the version, all being running plus ended', async () => {
    const fixture = panelFixture();
    const definitionId = fixture.world.definitionIds['order@1'];
    const panel = new DefinitionPanel(fixture.context, { bpmnProcessId: ORDER, definitionId });

    await panel.handle({ type: 'ready' });

    expect(readyView(fixture.lastState()).scopeCounts).toEqual({
      running: 2,
      withIncident: 1,
      ended: 1,
      all: 3,
    });
  });

  test('counts what the element filter and the business key leave', async () => {
    const fixture = panelFixture();
    const definitionId = fixture.world.definitionIds['order@1'];
    const panel = new DefinitionPanel(fixture.context, { bpmnProcessId: ORDER, definitionId });
    await panel.handle({ type: 'ready' });

    await panel.handle({
      type: 'filterInstances',
      filter: { scope: 'all', elementId: 'Activity_ReviewOrder' },
    });
    expect(readyView(fixture.lastState()).scopeCounts).toEqual({
      running: 1,
      withIncident: 0,
      ended: 0,
      all: 1,
    });

    await panel.handle({
      type: 'filterInstances',
      filter: { scope: 'running', businessKey: 'ORD-1003' },
    });
    expect(readyView(fixture.lastState()).scopeCounts).toEqual({
      running: 0,
      withIncident: 0,
      ended: 1,
      all: 1,
    });
  });

  test('keeps the counts when it loads more instances', async () => {
    const fixture = panelFixture(
      (runtime) =>
        new PatchedRuntime(runtime, {
          searchInstances: (filter, page) => runtime.searchInstances(filter, { ...page, limit: 1 }),
        }),
    );
    const definitionId = fixture.world.definitionIds['order@1'];
    const panel = new DefinitionPanel(fixture.context, { bpmnProcessId: ORDER, definitionId });
    await panel.handle({ type: 'ready' });
    const counted = fixture.calls.filter((call) => call === 'countInstances').length;

    await panel.handle({ type: 'loadMoreInstances' });

    expect(fixture.calls.filter((call) => call === 'countInstances')).toHaveLength(counted);
    expect(readyView(fixture.lastState()).scopeCounts.running).toBe(2);
  });

  test('points at older versions that still run instances', async () => {
    const fixture = panelFixture();
    const panel = new DefinitionPanel(fixture.context, { bpmnProcessId: ORDER });

    await panel.handle({ type: 'ready' });

    expect(readyView(fixture.lastState()).notices).toEqual([
      {
        tone: 'info',
        title: '2 instances still run on older versions.',
        actions: [
          {
            kind: 'selectVersion',
            label: 'Show v1',
            definitionId: fixture.world.definitionIds['order@1'],
          },
        ],
      },
    ]);
  });

  test('switches to another version with its own badges', async () => {
    const fixture = panelFixture();
    const panel = new DefinitionPanel(fixture.context, { bpmnProcessId: ORDER });
    await panel.handle({ type: 'ready' });

    await panel.handle({
      type: 'selectVersion',
      definitionId: fixture.world.definitionIds['order@1'],
    });

    const view = readyView(fixture.lastState());
    expect(view.badges.find((badge) => badge.elementId === 'Activity_ChargePayment')).toEqual({
      elementId: 'Activity_ChargePayment',
      running: 0,
      incidents: 1,
      incidentsInCalledInstances: 0,
    });
    expect(view.notices).toEqual([]);
  });

  test('filters the instances by incident and by element', async () => {
    const fixture = panelFixture();
    const definitionId = fixture.world.definitionIds['order@1'];
    const panel = new DefinitionPanel(fixture.context, { bpmnProcessId: ORDER, definitionId });
    await panel.handle({ type: 'ready' });

    await panel.handle({ type: 'filterInstances', filter: { scope: 'withIncident' } });
    expect(readyView(fixture.lastState()).instances.map((row) => row.businessKey)).toEqual([
      'ORD-1002',
    ]);

    await panel.handle({
      type: 'filterInstances',
      filter: { scope: 'running', elementId: 'Activity_ReviewOrder' },
    });
    expect(readyView(fixture.lastState()).instances.map((row) => row.businessKey)).toEqual([
      'ORD-1001',
    ]);
  });

  test('keeps the last view while refreshing and when a refresh fails', async () => {
    let failing = false;
    const fixture = panelFixture(
      (runtime) =>
        new PatchedRuntime(runtime, {
          listVersions: (bpmnProcessId) =>
            failing
              ? Promise.reject(new RuntimeError('unreachable', 'connect ECONNREFUSED'))
              : runtime.listVersions(bpmnProcessId),
        }),
    );
    const panel = new DefinitionPanel(fixture.context, { bpmnProcessId: ORDER });
    await panel.handle({ type: 'ready' });
    failing = true;

    await panel.handle({ type: 'refresh' });

    const [refreshing, failed] = fixture.states.slice(-2);
    expect(refreshing).toMatchObject({ status: 'ready', refreshing: true });
    expect(failed).toMatchObject({
      status: 'failed',
      problem: { title: "Can't reach local.", canEditConnection: true },
      staleView: { kind: 'definition' },
    });
  });

  test('reports an unknown process as not found', async () => {
    const fixture = panelFixture();
    const panel = new DefinitionPanel(fixture.context, { bpmnProcessId: BpmnProcessId('nope') });

    await panel.handle({ type: 'ready' });

    expect(fixture.lastState()).toMatchObject({
      status: 'failed',
      problem: { title: 'The process nope was not found.' },
    });
  });

  test('hands host actions to the effects', async () => {
    const fixture = panelFixture();
    const panel = new DefinitionPanel(fixture.context, { bpmnProcessId: ORDER });

    await panel.handle({ type: 'openInstance', instanceId: 'fake-ORD-1001', toSide: true });
    await panel.handle({ type: 'copy', text: 'fake-ORD-1001', label: 'Instance ID' });
    await panel.handle({ type: 'editConnection' });

    expect(fixture.effects.openInstance).toHaveBeenCalledWith('fake-ORD-1001', { toSide: true });
    expect(fixture.effects.copyToClipboard).toHaveBeenCalledWith('fake-ORD-1001', 'Instance ID');
    expect(fixture.effects.editConnection).toHaveBeenCalledOnce();
  });

  test('publishes only the latest of two overlapping loads', async () => {
    const fixture = panelFixture();
    const panel = new DefinitionPanel(fixture.context, { bpmnProcessId: ORDER });
    await panel.handle({ type: 'ready' });

    await Promise.all([
      panel.handle({ type: 'filterInstances', filter: { scope: 'withIncident' } }),
      panel.handle({ type: 'filterInstances', filter: { scope: 'running' } }),
    ]);

    const readyStates = fixture.states.filter(
      (state) => state.status === 'ready' && !state.refreshing,
    );
    expect(readyView(readyStates.at(-1)!).filter.scope).toBe('running');
    expect(readyStates).toHaveLength(2);
  });

  test('loads more instances page by page and stops at the end', async () => {
    const fixture = panelFixture(
      (runtime) =>
        new PatchedRuntime(runtime, {
          searchInstances: (filter, page) => runtime.searchInstances(filter, { ...page, limit: 1 }),
        }),
    );
    const definitionId = fixture.world.definitionIds['order@1'];
    const panel = new DefinitionPanel(fixture.context, { bpmnProcessId: ORDER, definitionId });
    await panel.handle({ type: 'ready' });
    expect(readyView(fixture.lastState())).toMatchObject({ hasMoreInstances: true });

    await panel.handle({ type: 'loadMoreInstances' });
    const view = readyView(fixture.lastState());
    expect(view.instances.map((row) => row.businessKey).sort()).toEqual(['ORD-1001', 'ORD-1002']);
    expect(view.hasMoreInstances).toBe(false);

    const published = fixture.states.length;
    await panel.handle({ type: 'loadMoreInstances' });
    expect(fixture.states).toHaveLength(published);
  });

  test('finds instances by business key', async () => {
    const fixture = panelFixture();
    const definitionId = fixture.world.definitionIds['order@1'];
    const panel = new DefinitionPanel(fixture.context, { bpmnProcessId: ORDER, definitionId });
    await panel.handle({ type: 'ready' });

    await panel.handle({
      type: 'filterInstances',
      filter: { scope: 'all', businessKey: 'ORD-1003' },
    });

    expect(readyView(fixture.lastState()).instances).toEqual([
      expect.objectContaining({ businessKey: 'ORD-1003', state: 'Completed' }),
    ]);
  });

  test('republishes the last view when the webview comes back', async () => {
    const fixture = panelFixture();
    const panel = new DefinitionPanel(fixture.context, { bpmnProcessId: ORDER });
    await panel.handle({ type: 'ready' });
    const calls = fixture.calls.length;

    await panel.handle({ type: 'ready' });

    expect(fixture.calls).toHaveLength(calls);
    expect(fixture.lastState()).toMatchObject({ status: 'ready', refreshing: false });
  });

  test('opens the definition of another version on request', async () => {
    const fixture = panelFixture();
    const panel = new DefinitionPanel(fixture.context, { bpmnProcessId: ORDER });

    await panel.handle({
      type: 'openDefinition',
      bpmnProcessId: 'pulse-order',
      definitionId: 'pulse-order:1',
    });

    expect(fixture.effects.openDefinition).toHaveBeenCalledWith('pulse-order', 'pulse-order:1', {
      toSide: false,
    });
  });

  test('lists running instances by default and ended ones on request', async () => {
    const fixture = panelFixture();
    const definitionId = fixture.world.definitionIds['order@1'];
    const panel = new DefinitionPanel(fixture.context, { bpmnProcessId: ORDER, definitionId });
    await panel.handle({ type: 'ready' });
    expect(readyView(fixture.lastState()).instances.map((row) => row.state)).toEqual([
      'Running',
      'Running',
    ]);

    await panel.handle({
      type: 'filterInstances',
      filter: { scope: 'ended' },
    });
    expect(readyView(fixture.lastState()).instances.map((row) => row.businessKey)).toEqual([
      'ORD-1003',
    ]);

    await panel.handle({
      type: 'filterInstances',
      filter: { scope: 'all' },
    });
    expect(readyView(fixture.lastState()).instances).toHaveLength(3);
  });
});
