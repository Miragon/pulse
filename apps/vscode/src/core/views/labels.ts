import type { InstanceState, WaitStateKind } from '../../contract/index.js';
import type { InstanceStateLabel } from '../protocol/index.js';

const UUID_HEAD = /^[0-9a-f]{8}-[0-9a-f]{4}-/i;
const NUMERIC = /^\d+$/;
const SHORT_LENGTH = 8;

const STATE_LABELS: Readonly<Record<InstanceState, InstanceStateLabel>> = {
  running: 'Running',
  suspended: 'Suspended',
  completed: 'Completed',
  terminated: 'Terminated',
};

const WAIT_KIND_LABELS: Readonly<Record<WaitStateKind, string>> = {
  userTask: 'User task',
  workerTask: 'Worker task',
  asyncContinuation: 'Async continuation',
  timer: 'Timer',
  message: 'Message',
  signal: 'Signal',
  other: 'Waiting',
};

export class Labels {
  static shortId(id: string): string {
    if (UUID_HEAD.test(id)) {
      return `${id.slice(0, SHORT_LENGTH)}…`;
    }
    if (NUMERIC.test(id) && id.length > SHORT_LENGTH) {
      return `…${id.slice(-SHORT_LENGTH)}`;
    }
    return id;
  }

  static instanceState(state: InstanceState): InstanceStateLabel {
    return STATE_LABELS[state];
  }

  static waitKind(kind: WaitStateKind): string {
    return WAIT_KIND_LABELS[kind];
  }

  static humanize(engineType: string): string {
    const words = engineType
      .replace(/[_-]+/g, ' ')
      .replace(/([a-z\d])([A-Z])/g, '$1 $2')
      .trim()
      .toLowerCase();
    return words.charAt(0).toUpperCase() + words.slice(1);
  }

  static duration(milliseconds: number): string {
    if (milliseconds < 1000) {
      return `${Math.max(0, Math.round(milliseconds))} ms`;
    }
    const seconds = milliseconds / 1000;
    if (seconds < 60) {
      return `${seconds.toFixed(seconds < 10 ? 1 : 0)} s`;
    }
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) {
      return `${minutes} min ${Math.floor(seconds % 60)} s`;
    }
    const hours = Math.floor(minutes / 60);
    return hours < 24
      ? `${hours} h ${minutes % 60} min`
      : `${Math.floor(hours / 24)} d ${hours % 24} h`;
  }

  static capitalized(text: string): string {
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  static plural(count: number, noun: string, nouns = `${noun}s`): string {
    return `${count} ${count === 1 ? noun : nouns}`;
  }
}
