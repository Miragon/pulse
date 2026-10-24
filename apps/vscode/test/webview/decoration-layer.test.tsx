import { describe, expect, it } from 'vitest';
import { DecorationLayer } from '../../src/webview/diagram/decoration-layer.js';
import type { DiagramElement } from '../../src/webview/diagram/diagram-elements.js';

function servicesWith(ids: Set<string>) {
  const markers: string[] = [];
  const canvas = {
    addMarker: (id: string, marker: string) => {
      markers.push(`${id}:${marker}`);
    },
    removeMarker: (id: string) => {
      if (!ids.has(id)) {
        throw new TypeError("Cannot read properties of undefined (reading 'markers')");
      }
    },
  };
  return {
    markers,
    services: {
      overlays: { add: () => 'overlay', remove: () => undefined },
      selection: { select: () => undefined },
      canvas,
      registry: {
        get: (id: string) =>
          ids.has(id)
            ? ({ id, type: 'bpmn:Task', businessObject: {} } as unknown as DiagramElement)
            : undefined,
        getAll: () => [],
      },
      names: new Map<string, string>(),
    },
  };
}

describe('the decoration layer', () => {
  it('lets go of markers whose element the next diagram no longer has', () => {
    const ids = new Set(['Activity_ChargePayment', 'Activity_CalculateLoyaltyPoints']);
    const { services, markers } = servicesWith(ids);
    const layer = new DecorationLayer(
      services,
      () => undefined,
      () => undefined,
      () => undefined,
    );
    layer.apply({
      badges: [],
      markers: [{ elementId: 'Activity_CalculateLoyaltyPoints', kind: 'incident' }],
      calls: [],
      stale: false,
    });
    expect(markers).toEqual(['Activity_CalculateLoyaltyPoints:pulse-incident']);

    ids.delete('Activity_CalculateLoyaltyPoints');

    expect(() => {
      layer.apply({
        badges: [],
        markers: [{ elementId: 'Activity_ChargePayment', kind: 'waiting' }],
        calls: [],
        stale: false,
      });
    }).not.toThrow();
    expect(markers).toContain('Activity_ChargePayment:pulse-waiting');
  });
});
