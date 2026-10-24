import { glyphs } from '../components/lucide-glyphs.json';
import type { CalledInstanceLink as CalledInstance } from '../../core/protocol/index.js';
import { Icon } from '../components/icon.js';
import { useHost } from '../host/host-context.js';

export function CalledInstanceLink({ link }: { readonly link: CalledInstance }) {
  const host = useHost();
  return (
    <button
      type="button"
      class="link-button"
      title={`Open called instance ${link.instanceId}`}
      onClick={(event) => {
        event.stopPropagation();
        host.post({
          type: 'openInstance',
          instanceId: link.instanceId,
          toSide: event.metaKey || event.ctrlKey,
        });
      }}
    >
      {link.bpmnProcessId} <code>{link.shortId}</code>
      <Icon of={glyphs.ArrowUpRight} size={12} />
    </button>
  );
}
