import type { PanelState } from '../../../src/core/protocol/index.js';
import { BULK_RUNNING_DEFINITION, BULK_STOPPED_DEFINITION, SELECTING_DEFINITION } from './bulk.js';
import { DEFINITION_VIEW, ENDED_DEFINITION_VIEW, FILTERED_DEFINITION_VIEW } from './definition.js';
import { ENGINE_VIEW } from './engine.js';
import { LOCAL_ENGINE, PROD_ENGINE } from './engines.js';
import { INSTANCE_WAITING, INSTANCE_WITH_CALLED_INCIDENT } from './instance.js';
import { MIGRATION_VIEW, RUNNING_MIGRATION_VIEW, UNMAPPED_MIGRATION_VIEW } from './migration.js';
import { MOVABLE_INSTANCE, WRITABLE_INCIDENT_ID, WRITABLE_INSTANCE } from './writable.js';

const UNREACHABLE = {
  title: "Couldn't reach prod-eu.",
  detail:
    'connect ECONNREFUSED 10.0.4.12:8080. Check that the engine runs and that the endpoint is right.',
  canEditConnection: true,
} as const;

export const FIXTURES = {
  definition: { status: 'ready', view: DEFINITION_VIEW, refreshing: false },
  'definition-filtered': { status: 'ready', view: FILTERED_DEFINITION_VIEW, refreshing: false },
  'definition-ended': { status: 'ready', view: ENDED_DEFINITION_VIEW, refreshing: false },
  'definition-prod': {
    status: 'ready',
    view: { ...DEFINITION_VIEW, engine: PROD_ENGINE, notices: [] },
    refreshing: false,
  },
  'definition-selecting': { status: 'ready', view: SELECTING_DEFINITION, refreshing: false },
  'definition-bulk-running': { status: 'ready', view: BULK_RUNNING_DEFINITION, refreshing: false },
  'definition-bulk-stopped': { status: 'ready', view: BULK_STOPPED_DEFINITION, refreshing: false },
  migration: { status: 'ready', view: MIGRATION_VIEW, refreshing: false },
  'migration-unmapped': { status: 'ready', view: UNMAPPED_MIGRATION_VIEW, refreshing: false },
  'migration-running': { status: 'ready', view: RUNNING_MIGRATION_VIEW, refreshing: false },
  refreshing: { status: 'ready', view: DEFINITION_VIEW, refreshing: true },
  engine: { status: 'ready', view: ENGINE_VIEW, refreshing: false },
  instance: { status: 'ready', view: INSTANCE_WITH_CALLED_INCIDENT, refreshing: false },
  'instance-waiting': { status: 'ready', view: INSTANCE_WAITING, refreshing: false },
  'instance-writable': { status: 'ready', view: WRITABLE_INSTANCE, refreshing: false },
  'instance-movable': { status: 'ready', view: MOVABLE_INSTANCE, refreshing: false },
  'instance-retrying': {
    status: 'ready',
    view: {
      ...WRITABLE_INSTANCE,
      write: { status: 'pending', target: { kind: 'incident', incidentId: WRITABLE_INCIDENT_ID } },
    },
    refreshing: false,
  },
  'instance-failed-again': {
    status: 'ready',
    view: {
      ...WRITABLE_INSTANCE,
      outcome: {
        tone: 'danger',
        title: 'Failed again at Check credit.',
        detail: 'CardExpiredException: Card ending 4371 expired on 03/2025',
        actions: [],
      },
    },
    refreshing: false,
  },
  loading: { status: 'loading', title: 'Order fulfillment', engine: LOCAL_ENGINE },
  failed: {
    status: 'failed',
    problem: UNREACHABLE,
    engine: PROD_ENGINE,
    staleView: { ...DEFINITION_VIEW, engine: PROD_ENGINE, notices: [] },
  },
  'failed-empty': { status: 'failed', problem: UNREACHABLE, engine: PROD_ENGINE },
} as const satisfies Record<string, PanelState>;

export type FixtureName = keyof typeof FIXTURES;

export function isFixtureName(name: string): name is FixtureName {
  return Object.hasOwn(FIXTURES, name);
}
