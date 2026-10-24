import { useEffect, useRef, useState } from 'preact/hooks';
import type { BadgeFilter } from '../diagram/badge-cluster.js';
import type { Decorations } from '../diagram/decoration-layer.js';
import { RuntimeCanvas } from '../diagram/runtime-canvas.js';
import { useHost } from '../host/host-context.js';
import { EmptyHint } from './empty-hint.js';

export interface RuntimeDiagramProps {
  readonly xml: string;
  readonly decorations: Decorations;
  readonly onSelectElement: BadgeFilter;
  readonly onNames: (names: ReadonlyMap<string, string>) => void;
  readonly label?: string;
  readonly remembersView?: boolean;
  readonly keysOnCanvas?: boolean;
}

export function RuntimeDiagram(props: RuntimeDiagramProps) {
  const host = useHost();
  const { api } = host;
  const hostElement = useRef<HTMLDivElement>(null);
  const canvas = useRef<RuntimeCanvas | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const remembersView = props.remembersView !== false;
  const keysOnCanvas = props.keysOnCanvas === true;

  useEffect(() => {
    if (hostElement.current === null) {
      return undefined;
    }
    const created = new RuntimeCanvas({
      host: hostElement.current,
      stateApi: api,
      onSelectElement: (elementId, scope) => {
        latest.current.onSelectElement(elementId, scope);
      },
      onOpenCall: (elementId, toSide) => {
        host.post({ type: 'openCall', elementId, toSide });
      },
      onOpenCode: (elementId) => {
        host.post({ type: 'openCode', elementId });
      },
      onImported: (names) => {
        setFailure(undefined);
        latest.current.onNames(names);
      },
      onImportFailed: setFailure,
      remembersView,
      keysOnCanvas,
    });
    canvas.current = created;
    return () => {
      canvas.current = null;
      created.destroy();
    };
  }, [api, host, remembersView, keysOnCanvas]);

  useEffect(() => {
    void canvas.current?.update(props.xml, props.decorations);
  }, [props.xml, props.decorations]);

  return (
    <section class="diagram-region" aria-label={props.label ?? 'Diagram'}>
      <div class="diagram-host" ref={hostElement} />
      {failure !== undefined && (
        <div class="diagram-region__failure">
          <EmptyHint text="Couldn't draw the deployed diagram." />
        </div>
      )}
    </section>
  );
}
