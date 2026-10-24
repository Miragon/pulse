export type Tone = 'info' | 'warning' | 'danger';

type BulkNoticeKind =
  'stopBulk' | 'selectRemaining' | 'dismissBulk' | 'checkBulk' | 'showBulkFailures';

export type NoticeAction =
  | { readonly kind: 'openInstance'; readonly label: string; readonly instanceId: string }
  | { readonly kind: 'selectVersion'; readonly label: string; readonly definitionId: string }
  | { readonly kind: 'openIncidentDetails'; readonly label: string; readonly incidentId: string }
  | { readonly kind: 'retryIncident'; readonly label: string; readonly incidentId: string }
  | { readonly kind: BulkNoticeKind; readonly label: string };

export interface Notice {
  readonly tone: Tone;
  readonly title: string;
  readonly detail?: string;
  readonly actions: readonly NoticeAction[];
}
