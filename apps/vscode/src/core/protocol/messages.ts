import type { OfferedBulkKind } from './bulk-views.js';
import type { PanelState } from './panel-state.js';
import type { InstanceListFilter, ProcessListFilter } from './view-models.js';

export type WebviewIntent =
  | { readonly type: 'ready' }
  | { readonly type: 'refresh' }
  | { readonly type: 'goBack' }
  | { readonly type: 'selectVersion'; readonly definitionId: string }
  | { readonly type: 'filterInstances'; readonly filter: InstanceListFilter }
  | { readonly type: 'loadMoreInstances' }
  | { readonly type: 'filterProcesses'; readonly filter: ProcessListFilter }
  | { readonly type: 'openProcess'; readonly bpmnProcessId: string; readonly toSide: boolean }
  | { readonly type: 'openInstance'; readonly instanceId: string; readonly toSide: boolean }
  | { readonly type: 'openCall'; readonly elementId: string; readonly toSide: boolean }
  | {
      readonly type: 'openDefinition';
      readonly bpmnProcessId: string;
      readonly definitionId: string;
    }
  | { readonly type: 'openIncidentDetails'; readonly incidentId: string }
  | { readonly type: 'selectElement'; readonly elementId: string }
  | { readonly type: 'openModel'; readonly incidentId?: string; readonly elementId?: string }
  | { readonly type: 'openCode'; readonly incidentId?: string; readonly elementId?: string }
  | { readonly type: 'copy'; readonly text: string; readonly label: string }
  | { readonly type: 'copyHandover' }
  | { readonly type: 'openWebUi' }
  | { readonly type: 'editConnection' }
  | { readonly type: 'setCredentials' }
  | { readonly type: 'retryIncident'; readonly incidentId: string }
  | { readonly type: 'setVariable'; readonly name: string; readonly valueJson: string }
  | { readonly type: 'pauseLiveUpdates' }
  | { readonly type: 'resumeLiveUpdates' }
  | { readonly type: 'turnOnLiveUpdates' }
  | { readonly type: 'holdLiveUpdates'; readonly held: boolean }
  | {
      readonly type: 'toggleInstances';
      readonly ids: readonly string[];
      readonly selected: boolean;
    }
  | { readonly type: 'selectMatching' }
  | { readonly type: 'clearSelection' }
  | { readonly type: 'startBulk'; readonly action: OfferedBulkKind }
  | { readonly type: 'stopBulk' }
  | { readonly type: 'dismissBulk' }
  | { readonly type: 'checkBulk' }
  | { readonly type: 'selectRemaining' }
  | { readonly type: 'showBulkFailures' }
  | { readonly type: 'openMigration' }
  | { readonly type: 'pickMigrationTarget'; readonly definitionId: string }
  | {
      readonly type: 'mapElement';
      readonly sourceElementId: string;
      readonly targetElementId: string;
    }
  | { readonly type: 'unmapElement'; readonly sourceElementId: string }
  | { readonly type: 'focusMapping'; readonly sourceElementId: string }
  | { readonly type: 'leaveOutUnmapped' }
  | { readonly type: 'startMigration' }
  | { readonly type: 'activity' }
  | {
      readonly type: 'moveToken';
      readonly fromElementId: string;
      readonly toElementId: string;
      readonly reason: string;
    };

export type WebviewIntentType = WebviewIntent['type'];

export interface BackLink {
  readonly label: string;
}

export interface StateMessage {
  readonly type: 'state';
  readonly revision: number;
  readonly state: PanelState;
  readonly back?: BackLink;
}

export type HostMessage = StateMessage;
