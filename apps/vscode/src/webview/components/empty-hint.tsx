import type { ComponentChildren } from 'preact';

export interface EmptyHintProps {
  readonly text: string;
  readonly busy?: boolean;
  readonly action?: { readonly label: string; readonly onClick: () => void };
  readonly children?: ComponentChildren;
}

export function EmptyHint({ text, busy = false, action, children }: EmptyHintProps) {
  return (
    <div class="empty-hint" role={busy ? 'status' : undefined} aria-busy={busy || undefined}>
      {children}
      <p class="empty-hint__text">{text}</p>
      {action !== undefined && (
        <button type="button" class="button button--ghost" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  );
}
