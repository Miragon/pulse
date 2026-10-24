import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PanelState } from '../../src/core/protocol/index.js';
import { FILTERED_DEFINITION_VIEW } from '../../dev/webview/fixtures/definition.js';
import { FIXTURES } from '../../dev/webview/fixtures/states.js';
import { buttonNamed, fontsLoaded, mountApp, nextFrame, press, waitForElement } from './harness.js';
import type { Harness } from './harness.js';

const FILTERED: PanelState = { status: 'ready', refreshing: false, view: FILTERED_DEFINITION_VIEW };

function gripOf(root: ParentNode, label: string): HTMLElement {
  const grip = root.querySelector<HTMLElement>(`[aria-label="Resize column ${label}"]`);
  if (grip === null) {
    throw new Error(`No grip for ${label}.`);
  }
  grip.setPointerCapture = () => undefined;
  return grip;
}

function widthOf(element: Element | null | undefined): number {
  return Math.round(element?.getBoundingClientRect().width ?? 0);
}

function pointer(grip: HTMLElement, type: string, clientX: number): void {
  grip.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX, pointerId: 1 }));
}

function storedWidths(harness: Harness): unknown {
  return (harness.api.getState() as { pulse?: { columnWidths?: unknown } }).pulse?.columnWidths;
}

async function settled(): Promise<void> {
  await nextFrame();
}

describe('resizable columns', () => {
  let harness: Harness;

  beforeAll(fontsLoaded);

  afterEach(() => {
    harness.unmount();
  });

  it('offers a keyboard separator on every header but the last', async () => {
    harness = mountApp();
    harness.publish(FIXTURES.definition);
    await waitForElement(harness.root, '.data-table th [role="separator"]');

    const headers = [...harness.root.querySelectorAll('.data-table th')];
    const grips = headers.map((header) => header.querySelector('[role="separator"]'));

    expect(grips.map((grip) => grip?.getAttribute('aria-label'))).toEqual([
      'Resize column ID',
      'Resize column Business key',
      'Resize column State',
      undefined,
    ]);
    expect(grips[1]?.getAttribute('aria-orientation')).toBe('vertical');
    expect(grips[1]?.getAttribute('tabindex')).toBe('0');
  });

  it('keeps the content-fit layout until the first resize, then freezes every width', async () => {
    harness = mountApp();
    harness.publish(FIXTURES.definition);
    const grip = await waitForElement<HTMLElement>(
      harness.root,
      '[aria-label="Resize column Business key"]',
    );
    grip.focus();
    await settled();
    const headers = [...harness.root.querySelectorAll('.data-table th')];
    const before = headers.map(widthOf);
    expect(harness.root.querySelector('.data-table--fixed, colgroup')).toBeNull();
    expect(grip.getAttribute('aria-valuenow')).toBe(String(before[1]));
    press(grip, 'ArrowRight');
    await settled();

    expect(harness.root.querySelector('.data-table--fixed')).not.toBeNull();
    expect(headers.map(widthOf).slice(0, 3)).toEqual([before[0], (before[1] ?? 0) + 8, before[2]]);
    expect(grip.getAttribute('aria-valuetext')).toBe(`${(before[1] ?? 0) + 8} pixels`);
    press(grip, 'ArrowRight', { shiftKey: true });
    await settled();
    press(grip, 'ArrowLeft');
    await settled();
    expect(widthOf(headers[1])).toBe((before[1] ?? 0) + 32);
  });

  it('sets the minimum with Home: the label plus 24 pixels, never below 48', async () => {
    harness = mountApp();
    harness.publish(FIXTURES.definition);
    const grip = await waitForElement<HTMLElement>(harness.root, '[aria-label="Resize column ID"]');
    const label = harness.root.querySelector('.data-table th .data-table__label')!;

    press(grip, 'Home');
    await settled();

    expect(widthOf(grip.parentElement)).toBe(Math.max(48, Math.round(label.scrollWidth + 24)));
  });

  it('drags a column and keeps its width in the webview state of the panel', async () => {
    harness = mountApp();
    harness.publish(FIXTURES.definition);
    await waitForElement(harness.root, '[aria-label="Resize column Business key"]');
    const grip = gripOf(harness.root, 'Business key');
    const start = widthOf(grip.parentElement);

    pointer(grip, 'pointerdown', 300);
    pointer(grip, 'pointermove', 360);
    await settled();
    pointer(grip, 'pointerup', 360);
    await settled();

    expect(widthOf(grip.parentElement)).toBe(start + 60);
    expect(storedWidths(harness)).toMatchObject({ instances: { businessKey: start + 60 } });
    expect(document.documentElement.querySelector('[data-dragging]')).toBeNull();
  });

  it('restores the start width when Escape cancels a drag and keeps the element filter', async () => {
    harness = mountApp();
    harness.publish(FILTERED);
    await waitForElement(harness.root, '[aria-label="Resize column Business key"]');
    const grip = gripOf(harness.root, 'Business key');
    const start = widthOf(grip.parentElement);

    pointer(grip, 'pointerdown', 300);
    pointer(grip, 'pointermove', 380);
    await settled();
    expect(widthOf(grip.parentElement)).toBe(start + 80);
    press(grip, 'Escape');
    pointer(grip, 'pointermove', 420);
    pointer(grip, 'pointerup', 420);
    await settled();

    expect(widthOf(grip.parentElement)).toBe(start);
    expect(harness.posted.filter((intent) => intent.type === 'filterInstances')).toEqual([]);
  });

  it('fits a column to its widest cell with a double-click or Enter', async () => {
    harness = mountApp();
    harness.publish(FIXTURES.definition);
    await waitForElement(harness.root, '[aria-label="Resize column Business key"]');
    const grip = gripOf(harness.root, 'Business key');
    const natural = widthOf(grip.parentElement);

    press(grip, 'ArrowRight', { shiftKey: true });
    await settled();
    grip.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await settled();
    expect(widthOf(grip.parentElement)).toBe(natural);

    press(grip, 'Home');
    await settled();
    press(grip, 'Enter');
    await settled();
    expect(widthOf(grip.parentElement)).toBe(natural);
  });

  it('fits at most half of the visible table', async () => {
    harness = mountApp({ width: 500 });
    harness.publish(FIXTURES.instance);
    await waitForElement(harness.root, '.incident-card');
    buttonNamed(harness.root, 'Variables6').click();
    await waitForElement(harness.root, '[aria-label="Resize column Value"]');
    const grip = gripOf(harness.root, 'Value');
    const visible = harness.root.querySelector('.data-table')!.clientWidth;

    press(grip, 'Enter');
    await settled();

    expect(widthOf(grip.parentElement)).toBe(Math.round(visible / 2));
  });

  it('restores kept widths and ignores widths it cannot trust', async () => {
    harness = mountApp({
      stored: {
        pulse: { columnWidths: { instances: { id: 120, businessKey: 200, state: 140 } } },
      },
    });
    harness.publish(FIXTURES.definition);
    await waitForElement(harness.root, '.data-table--fixed');
    const headers = [...harness.root.querySelectorAll('.data-table th')];
    expect(headers.map(widthOf).slice(0, 3)).toEqual([120, 200, 140]);
    harness.unmount();

    for (const kept of [{ id: 5, businessKey: 200, state: 140 }, { id: 120 }, 'wide']) {
      harness = mountApp({ stored: { pulse: { columnWidths: { instances: kept } } } });
      harness.publish(FIXTURES.definition);
      await waitForElement(harness.root, '.data-table th');
      expect(harness.root.querySelector('.data-table--fixed')).toBeNull();
      harness.unmount();
    }
    harness = mountApp();
  });

  it('cuts off a cell with an ellipsis and offers the full text as its title', async () => {
    harness = mountApp({
      stored: {
        pulse: { columnWidths: { instances: { id: 120, businessKey: 48, state: 140 } } },
      },
    });
    harness.publish(FIXTURES.definition);
    const row = await waitForElement(harness.root, '.data-table__row');
    const cell = row.querySelectorAll('td')[1]!;

    cell.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));

    expect(cell.title).toBe('ORD-10442');
    expect(getComputedStyle(cell).textOverflow).toBe('ellipsis');
  });

  it('keeps the widths of the Waiting and the Variables table apart', async () => {
    harness = mountApp();
    harness.publish(FIXTURES.instance);
    await waitForElement(harness.root, '.incident-card');
    harness.root.querySelector<HTMLElement>('[data-key="waiting"]')?.click();
    await waitForElement(harness.root, '[aria-label="Resize column Waiting at"]');
    press(gripOf(harness.root, 'Waiting at'), 'Home');
    buttonNamed(harness.root, 'Variables6').click();
    await waitForElement(harness.root, '[aria-label="Resize column Name"]');
    press(gripOf(harness.root, 'Name'), 'Home');

    await vi.waitFor(() => {
      expect(Object.keys(storedWidths(harness) as object).sort()).toEqual(['variables', 'waiting']);
    });
  });
});

describe('the split between diagram and list', () => {
  let harness: Harness;

  afterEach(() => {
    harness.unmount();
  });

  it('moves with the arrow keys and restores its share when Escape cancels a drag', async () => {
    harness = mountApp();
    harness.publish(FIXTURES.definition);
    const handle = await waitForElement<HTMLElement>(harness.root, '.split-layout__handle');
    handle.setPointerCapture = () => undefined;

    press(handle, 'ArrowDown');
    await settled();
    expect(handle.getAttribute('aria-valuenow')).toBe('60');

    handle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientY: 400 }));
    handle.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientY: 300 }));
    await settled();
    expect(handle.getAttribute('aria-valuenow')).not.toBe('60');
    press(handle, 'Escape');
    await settled();

    expect(handle.getAttribute('aria-valuenow')).toBe('60');
  });
});
