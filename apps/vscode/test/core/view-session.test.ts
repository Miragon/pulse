import { RuntimeError } from '../../src/contract/index.js';
import { describe, expect, test } from 'vitest';
import { ViewSession, type Snapshot } from '../../src/core/panels/view-session.js';
import type { EngineView } from '../../src/core/protocol/index.js';
import { panelFixture } from './support/panel-fixture.js';

describe('a view session that never loaded', () => {
  test('republishes nothing, not even the failure of its first load', async () => {
    const fixture = panelFixture();
    const session = new ViewSession<EngineView, Snapshot<EngineView>>(fixture.context, 'local');
    await session.reload(() => Promise.reject(new RuntimeError('unreachable', 'ECONNREFUSED')));
    const published = [...fixture.states];

    session.republish();
    session.rebuild((loaded) => loaded);

    expect(fixture.states).toEqual(published);
    expect(published.at(-1)?.status).toBe('failed');
  });
});
