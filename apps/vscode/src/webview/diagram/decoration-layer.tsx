import { render } from 'preact';
import type {
  CallLink,
  ElementBadge,
  ElementMarker,
  MarkerKind,
} from '../../core/protocol/index.js';
import type { VNode } from 'preact';
import { BadgeCluster, type BadgeFilter } from './badge-cluster.js';
import { CallButton } from './call-button.js';
import type { ElementRegistryLike } from './diagram-elements.js';
import { CodeButton, type ElementCode } from './code-button.js';
import { MoveBadge, type MoveBadgeKind } from './move-badge.js';
import { MoveEntry, type MoveEntryDecoration } from './move-entry.js';

export interface MoveDecoration {
  readonly from: string;
  readonly to?: string;
  readonly targets: readonly string[];
  readonly refused: readonly string[];
}

export interface Decorations {
  readonly badges: readonly ElementBadge[];
  readonly markers: readonly ElementMarker[];
  readonly calls: readonly CallLink[];
  readonly stale: boolean;
  readonly focusElementId?: string | undefined;
  readonly codes?: readonly ElementCode[];
  readonly move?: MoveDecoration | undefined;
  readonly moveEntry?: MoveEntryDecoration | undefined;
  readonly candidates?: readonly string[];
  readonly unmapped?: readonly string[];
}

export interface OverlaysLike {
  add(element: string, type: string, overlay: object): string;
  remove(filter: { readonly type: string }): void;
}

export interface CanvasMarkersLike {
  addMarker(element: string, marker: string): void;
  removeMarker(element: string, marker: string): void;
}

export interface SelectionLike {
  select(element: object | null): void;
}

export interface DecorationServices {
  readonly overlays: OverlaysLike;
  readonly selection: SelectionLike;
  readonly canvas: CanvasMarkersLike;
  readonly registry: ElementRegistryLike;
  readonly names: ReadonlyMap<string, string>;
}

const BADGE_OVERLAY_TYPE = 'pulse-badges';

const MARKER_CLASSES: Readonly<Record<MarkerKind, string>> = {
  waiting: 'pulse-waiting',
  incident: 'pulse-incident',
  incidentInCalledInstance: 'pulse-incident-called',
  completed: 'pulse-completed',
  taken: 'pulse-taken',
};

const BADGE_POSITION = { top: -10, right: -6 } as const;
const MOVE_POSITION = { top: -12, left: -6 } as const;
const CALL_POSITION = { bottom: -7, right: -8 } as const;
const CODE_POSITION = { bottom: -14, left: -8 } as const;
const BADGE_SCALE = { min: 0.7, max: 1 } as const;
const CALL_SCALE = { min: 0.7 } as const;

export class DecorationLayer {
  private readonly anchors: HTMLElement[] = [];
  private markers: (readonly [string, string])[] = [];
  private applied: string | undefined;

  constructor(
    private readonly services: DecorationServices,
    private readonly onSelect: BadgeFilter,
    private readonly onOpenCall: (elementId: string, toSide: boolean) => void,
    private readonly onOpenCode: (elementId: string) => void,
  ) {}

  apply(decorations: Decorations): void {
    const wanted = JSON.stringify(decorations);
    if (wanted === this.applied) {
      return;
    }
    this.clear();
    this.applied = wanted;
    for (const badge of decorations.badges) {
      this.addBadge(badge, decorations.stale);
    }
    for (const call of decorations.calls) {
      this.addOverlay(
        call.elementId,
        CALL_POSITION,
        <CallButton call={call} onOpen={this.onOpenCall} />,
        CALL_SCALE,
      );
    }
    this.addElementActions(decorations.codes ?? [], decorations.moveEntry);
    for (const marker of decorations.markers) {
      this.addMarker(marker.elementId, MARKER_CLASSES[marker.kind]);
    }
    for (const badge of decorations.badges) {
      if (badge.incidents > 0) {
        this.addMarker(badge.elementId, MARKER_CLASSES.incident);
      }
    }
    if (decorations.move !== undefined) {
      this.addMove(decorations.move);
    }
    this.addMapping(decorations);
    this.focus(decorations.focusElementId);
  }

  clear(): void {
    this.applied = undefined;
    for (const anchor of this.anchors.splice(0)) {
      render(null, anchor);
    }
    this.services.overlays.remove({ type: BADGE_OVERLAY_TYPE });
    for (const [elementId, marker] of this.markers) {
      if (this.services.registry.get(elementId) !== undefined) {
        this.services.canvas.removeMarker(elementId, marker);
      }
    }
    this.markers = [];
  }

  private addElementActions(
    codes: readonly ElementCode[],
    entry: MoveEntryDecoration | undefined,
  ): void {
    const elementIds = new Set([
      ...codes.map((code) => code.elementId),
      ...(entry === undefined ? [] : [entry.elementId]),
    ]);
    for (const elementId of elementIds) {
      const code = codes.find((candidate) => candidate.elementId === elementId);
      const move = entry?.elementId === elementId ? entry : undefined;
      this.addOverlay(
        elementId,
        CODE_POSITION,
        <span class="element-actions">
          {code !== undefined && <CodeButton code={code} onOpen={this.onOpenCode} />}
          {move !== undefined && <MoveEntry entry={move} />}
        </span>,
        CALL_SCALE,
      );
    }
  }

  private addMove(move: MoveDecoration): void {
    for (const elementId of move.targets.filter((target) => target !== move.from)) {
      this.addMarker(elementId, 'pulse-move-target');
    }
    for (const elementId of move.refused) {
      this.addMarker(elementId, 'pulse-move-refused');
    }
    if (move.to === undefined) {
      return;
    }
    const again = move.to === move.from;
    if (!again) {
      this.addMarker(move.from, 'pulse-move-from');
      this.addMoveBadge(move.from, 'from');
    }
    this.addMarker(move.to, 'pulse-move-to');
    this.addMoveBadge(move.to, again ? 'again' : 'to');
  }

  private addMapping({ candidates = [], unmapped = [] }: Decorations): void {
    for (const elementId of candidates) {
      this.addMarker(elementId, 'pulse-move-target');
    }
    for (const elementId of unmapped) {
      this.addMarker(elementId, 'pulse-unmapped');
    }
  }

  private addMoveBadge(elementId: string, kind: MoveBadgeKind): void {
    this.addOverlay(elementId, MOVE_POSITION, <MoveBadge kind={kind} />, BADGE_SCALE);
  }

  private focus(elementId: string | undefined): void {
    const element = elementId === undefined ? undefined : this.services.registry.get(elementId);
    this.services.selection.select(element ?? null);
  }

  private addBadge(badge: ElementBadge, stale: boolean): void {
    this.addOverlay(
      badge.elementId,
      BADGE_POSITION,
      <BadgeCluster
        badge={badge}
        elementName={this.services.names.get(badge.elementId) ?? badge.elementId}
        stale={stale}
        onSelect={this.onSelect}
      />,
      BADGE_SCALE,
    );
  }

  private addOverlay(elementId: string, position: object, content: VNode, scale: object): void {
    if (this.services.registry.get(elementId) === undefined) {
      return;
    }
    const anchor = document.createElement('div');
    anchor.className = 'badge-anchor';
    render(content, anchor);
    this.anchors.push(anchor);
    this.services.overlays.add(elementId, BADGE_OVERLAY_TYPE, {
      position,
      scale,
      html: anchor,
    });
  }

  private addMarker(elementId: string, marker: string): void {
    if (this.services.registry.get(elementId) === undefined) {
      return;
    }
    this.services.canvas.addMarker(elementId, marker);
    this.markers.push([elementId, marker]);
  }
}
