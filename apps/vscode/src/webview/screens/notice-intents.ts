import type { NoticeAction, WebviewIntent } from '../../core/protocol/index.js';

export class NoticeIntents {
  static of(action: NoticeAction): WebviewIntent {
    switch (action.kind) {
      case 'openInstance':
        return { type: 'openInstance', instanceId: action.instanceId, toSide: false };
      case 'selectVersion':
        return { type: 'selectVersion', definitionId: action.definitionId };
      case 'openIncidentDetails':
        return { type: 'openIncidentDetails', incidentId: action.incidentId };
      case 'retryIncident':
        return { type: 'retryIncident', incidentId: action.incidentId };
      default:
        return { type: action.kind };
    }
  }
}
