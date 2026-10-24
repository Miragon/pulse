import { glyphs } from './lucide-glyphs.json';
import type { Tone } from '../../core/protocol/index.js';
import { Icon } from './icon.js';

export interface StripAction {
  readonly label: string;
  readonly icon: string;
  readonly onClick: () => void;
  readonly busyLabel?: string | undefined;
  readonly disabled?: boolean;
}

export interface StatusStripProps {
  readonly tone: Tone;
  readonly title: string;
  readonly detail?: string | undefined;
  readonly actions?: readonly StripAction[];
}

export const TONE_GLYPHS: Readonly<Record<Tone, string>> = {
  info: glyphs.Info,
  warning: glyphs.TriangleAlert,
  danger: glyphs.CircleX,
};

export function StripButton({ action }: { readonly action: StripAction }) {
  const busy = action.busyLabel !== undefined;
  const label = action.busyLabel ?? action.label;
  return (
    <button
      type="button"
      class="button button--secondary button--strip"
      title={label}
      aria-label={label}
      disabled={busy || action.disabled === true}
      onClick={action.onClick}
    >
      <Icon of={busy ? glyphs.LoaderCircle : action.icon} class={busy ? 'spin' : undefined} />
      <span class="button__label">{label}</span>
    </button>
  );
}

export function StatusStrip({ tone, title, detail, actions = [] }: StatusStripProps) {
  return (
    <div class={`status-strip status-strip--${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      <Icon of={TONE_GLYPHS[tone]} class="status-strip__icon" />
      <p class="status-strip__text" title={detail === undefined ? title : `${title} ${detail}`}>
        <span class="status-strip__title">{title}</span>
        {detail !== undefined && <span class="status-strip__detail">{detail}</span>}
      </p>
      {actions.length > 0 && (
        <div class="status-strip__actions">
          {actions.map((action) => (
            <StripButton key={action.label} action={action} />
          ))}
        </div>
      )}
    </div>
  );
}
