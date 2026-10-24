import { afterEach, describe, expect, it } from 'vitest';
import { FIXTURES } from '../../dev/webview/fixtures/states.js';
import { mountApp, waitForElement } from './harness.js';
import type { Harness } from './harness.js';

describe('the History tab of an instance', () => {
  let harness: Harness;

  afterEach(() => {
    harness.unmount();
  });

  it('lists every element the instance ran through, the open one without an end', async () => {
    harness = mountApp();
    harness.publish(FIXTURES.instance);
    await waitForElement(harness.root, '.incident-card');
    harness.root.querySelector<HTMLElement>('[data-key="history"]')?.click();
    const table = await waitForElement(harness.root, 'table[aria-label="History"]');

    const rows = [...table.querySelectorAll('tbody tr')].map((row) =>
      [...row.querySelectorAll('td')].map((cell, index) =>
        index === 2 || index === 3 ? cell.textContent !== '–' : cell.textContent,
      ),
    );

    expect(rows).toEqual([
      ['Order received', 'Completed', true, true, '4 ms'],
      ['Reserve stock', 'Completed', true, true, '1 min 2 s'],
      ['Check credit', 'Active', true, false, '–'],
    ]);
  });
});
