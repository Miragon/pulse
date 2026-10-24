import type { EngineView, ProcessRow } from '../../../src/core/protocol/index.js';
import { AS_OF, LOCAL_ENGINE } from './engines.js';

const ORDER: ProcessRow = {
  bpmnProcessId: 'order-fulfillment',
  name: 'Order fulfillment',
  latestVersion: 3,
  running: 150,
  withIncident: 9,
};

const RETURNS: ProcessRow = {
  bpmnProcessId: 'return-handling',
  name: 'Return handling',
  latestVersion: 1,
  running: 15,
  withIncident: 1,
};

const SHIPMENT: ProcessRow = {
  bpmnProcessId: 'shipment',
  latestVersion: 1,
  running: 1_204,
  withIncident: 0,
};

export const ENGINE_VIEW: EngineView = {
  kind: 'engine',
  engine: {
    ...LOCAL_ENGINE,
    name: 'shop-dev',
    access: { writable: true, note: 'Writes allowed.' },
  },
  asOf: AS_OF,
  summary: '3 processes · 1369 running · 10 with incident',
  processes: [ORDER, RETURNS, SHIPMENT],
  filter: { scope: 'all' },
  scopeCounts: { all: 3, withIncident: 2 },
  emptyText: 'No processes match this filter.',
  webUi: { label: 'Open in Cockpit', title: 'Open Cockpit on shop-dev' },
};
