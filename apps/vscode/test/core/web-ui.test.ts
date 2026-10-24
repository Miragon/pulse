import { BpmnProcessId } from '../../src/contract/index.js';
import { describe, expect, test } from 'vitest';
import { DefinitionPanel } from '../../src/core/panels/definition-panel.js';
import { InstancePanel } from '../../src/core/panels/instance-panel.js';
import type { EngineBadge, PanelState } from '../../src/core/protocol/index.js';
import { panelFixture } from './support/panel-fixture.js';

const WITH_COCKPIT: EngineBadge = {
  name: 'shop-dev',
  environment: 'local',
  host: 'localhost:18090',
  webUi: 'Cockpit',
};
const ORDER = BpmnProcessId('pulse-order');

function viewOf(state: PanelState) {
  if (state.status !== 'ready' || state.view.kind === 'migration') {
    throw new Error(`expected a ready view with a web UI, got ${state.status}`);
  }
  return state.view;
}

describe('the link into the engine web UI', () => {
  test('opens the shown version of a definition there', async () => {
    const fixture = panelFixture(undefined, { engine: WITH_COCKPIT });
    const definitionId = fixture.world.definitionIds['order@1'];
    const panel = new DefinitionPanel(fixture.context, { bpmnProcessId: ORDER, definitionId });
    await panel.handle({ type: 'ready' });

    expect(viewOf(fixture.lastState()).webUi).toEqual({
      label: 'Open in Cockpit',
      title: 'Open Order fulfillment v1 in Cockpit on shop-dev',
    });

    await panel.handle({ type: 'openWebUi' });

    expect(fixture.effects.openWebUi).toHaveBeenCalledWith({
      kind: 'definition',
      definition: expect.objectContaining({ id: definitionId, version: 1 }) as unknown,
    });
  });

  test('opens the shown instance there', async () => {
    const fixture = panelFixture(undefined, { engine: WITH_COCKPIT });
    const instanceId = fixture.world.instanceIds['ORD-1002'];
    const panel = new InstancePanel(fixture.context, instanceId);
    await panel.handle({ type: 'ready' });

    expect(viewOf(fixture.lastState()).webUi?.title).toBe('Open ORD-1002 in Cockpit on shop-dev');

    await panel.handle({ type: 'openWebUi' });

    expect(fixture.effects.openWebUi).toHaveBeenCalledWith({
      kind: 'instance',
      instance: expect.objectContaining({ id: instanceId, hasIncident: true }) as unknown,
    });
  });

  test('is not offered, and opens nothing, when the engine has no known web UI', async () => {
    const fixture = panelFixture();
    const definitions = new DefinitionPanel(fixture.context, { bpmnProcessId: ORDER });
    const instance = new InstancePanel(fixture.context, fixture.world.instanceIds['ORD-1001']);
    await definitions.handle({ type: 'openWebUi' });
    await definitions.handle({ type: 'ready' });
    const definitionView = viewOf(fixture.lastState());
    await instance.handle({ type: 'ready' });

    await definitions.handle({ type: 'openWebUi' });
    await instance.handle({ type: 'openWebUi' });

    expect(definitionView.webUi).toBeUndefined();
    expect(viewOf(fixture.lastState()).webUi).toBeUndefined();
    expect(fixture.effects.openWebUi).not.toHaveBeenCalled();
  });
});
