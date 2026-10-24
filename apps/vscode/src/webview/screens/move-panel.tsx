import { useEffect, useRef, useState } from 'preact/hooks';
import type { MoveOption, MoveTarget } from '../../core/protocol/index.js';
import { Icon } from '../components/icon.js';
import { glyphs } from '../components/lucide-glyphs.json';
import { useLiveHold } from '../host/live-hold.js';
import { useSubmission } from '../host/submission.js';
import { useWriteState } from '../host/write-context.js';
import { WriteStates } from '../host/write-states.js';

const MAX_REASON_LENGTH = 500;
const PICK_HINT = 'Click an element on the diagram or pick it here.';

export interface MoveChoice {
  readonly from: string;
  readonly to?: string | undefined;
  readonly hint?: string | undefined;
}

export interface MovePanelProps {
  readonly choice: MoveChoice;
  readonly option: MoveOption | undefined;
  readonly fromLabel: string;
  readonly onPick: (elementId: string) => void;
  readonly onClose: () => void;
}

function Review({ target }: { readonly target: MoveTarget }) {
  return (
    <ul class="move-panel__review" aria-label="What the move does">
      {target.effects.map((effect) => (
        <li key={effect}>{effect}</li>
      ))}
      {target.warnings.map((warning) => (
        <li key={warning} class="move-panel__warning">
          <Icon of={glyphs.TriangleAlert} size={12} />
          {warning}
        </li>
      ))}
      <li class="move-panel__final">This can't be undone.</li>
    </ul>
  );
}

function TargetPicker({
  option,
  choice,
  onPick,
}: {
  readonly option: MoveOption;
  readonly choice: MoveChoice;
  readonly onPick: (elementId: string) => void;
}) {
  return (
    <label class="move-panel__field">
      <span>To</span>
      <select
        class="move-panel__input"
        value={choice.to ?? ''}
        onChange={(event) => {
          onPick(event.currentTarget.value);
        }}
      >
        <option value="" disabled>
          Pick an element
        </option>
        {option.targets.map((target) => (
          <option key={target.elementId} value={target.elementId}>
            {target.elementId === option.fromElementId ? `${target.label} (again)` : target.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function ReasonField({
  reason,
  onReason,
}: {
  readonly reason: string;
  readonly onReason: (reason: string) => void;
}) {
  return (
    <label class="move-panel__field">
      <span>Reason</span>
      <input
        type="text"
        class="move-panel__input"
        maxLength={MAX_REASON_LENGTH}
        required
        placeholder="Why does the token move?"
        value={reason}
        onInput={(event) => {
          onReason(event.currentTarget.value);
        }}
      />
    </label>
  );
}

function Gone({
  fromLabel,
  onClose,
}: {
  readonly fromLabel: string;
  readonly onClose: () => void;
}) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    close.current?.focus();
  }, []);
  return (
    <section class="move-panel" role="group" aria-label={`Move the token at ${fromLabel}`}>
      <p role="status">This token is no longer at {fromLabel}.</p>
      <div class="move-panel__actions">
        <button type="button" class="button button--secondary" ref={close} onClick={onClose}>
          Close
        </button>
      </div>
    </section>
  );
}

function useMoveForm(choice: MoveChoice, option: MoveOption | undefined, onClose: () => void) {
  const write = useWriteState();
  const mine = WriteStates.on(write, { kind: 'token', fromElementId: choice.from });
  const submission = useSubmission(mine, onClose);
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const target = option?.targets.find((candidate) => candidate.elementId === choice.to);
  const failed =
    submission.phase !== 'editing' && mine?.status === 'failed' ? mine.message : undefined;
  const busy = WriteStates.isWriting(write);
  const submit = (): void => {
    const why =
      target === undefined
        ? 'Pick where the token goes.'
        : reason.trim() === ''
          ? 'Give a reason for the move.'
          : undefined;
    setProblem(why);
    if (why === undefined && option !== undefined && target !== undefined && !busy) {
      submission.submit({
        type: 'moveToken',
        fromElementId: option.fromElementId,
        toElementId: target.elementId,
        reason,
      });
    }
  };
  return {
    target,
    reason,
    setReason,
    error: problem ?? failed,
    busy,
    pending: mine?.status === 'pending',
    submit,
  };
}

function MoveActions({
  form,
  onClose,
}: {
  readonly form: ReturnType<typeof useMoveForm>;
  readonly onClose: () => void;
}) {
  return (
    <div class="move-panel__actions">
      <button
        type="button"
        class="button button--primary"
        disabled={form.busy}
        onClick={form.submit}
      >
        {form.pending ? 'Moving…' : 'Move…'}
      </button>
      <button type="button" class="button button--secondary" onClick={onClose}>
        Cancel
      </button>
    </div>
  );
}

export function MovePanel({ choice, option, fromLabel, onPick, onClose }: MovePanelProps) {
  useLiveHold();
  const form = useMoveForm(choice, option, onClose);
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    panel.current?.querySelector('select')?.focus();
  }, []);
  if (option === undefined) {
    return <Gone fromLabel={fromLabel} onClose={onClose} />;
  }
  return (
    <section
      class="move-panel"
      role="group"
      aria-label={`Move the token at ${option.fromLabel}`}
      ref={panel}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <h2 class="move-panel__title">Move the token at {option.fromLabel}</h2>
      <TargetPicker option={option} choice={choice} onPick={onPick} />
      <p class="move-panel__status muted" role="status">
        {choice.hint ?? PICK_HINT}
      </p>
      {form.target !== undefined && <Review target={form.target} />}
      <ReasonField reason={form.reason} onReason={form.setReason} />
      <p class="move-panel__hint muted">
        Engines with a login keep the reason in their operation log. Change variables in the
        Variables tab first if the target needs them.
      </p>
      {form.error !== undefined && (
        <p class="move-panel__error" role="alert">
          {form.error}
        </p>
      )}
      <MoveActions form={form} onClose={onClose} />
    </section>
  );
}
