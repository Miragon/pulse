const LOCALE = 'en';

const clock = new Intl.DateTimeFormat(LOCALE, {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const clockWithSeconds = new Intl.DateTimeFormat(LOCALE, {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});
const dayAndClock = new Intl.DateTimeFormat(LOCALE, {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const preciseClock = new Intl.DateTimeFormat(LOCALE, {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  fractionalSecondDigits: 3,
  hourCycle: 'h23',
});
const dayAndPreciseClock = new Intl.DateTimeFormat(LOCALE, {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  fractionalSecondDigits: 3,
  hourCycle: 'h23',
});
const local = new Intl.DateTimeFormat(LOCALE, {
  dateStyle: 'medium',
  timeStyle: 'long',
  hourCycle: 'h23',
});
const utc = new Intl.DateTimeFormat(LOCALE, {
  dateStyle: 'medium',
  timeStyle: 'medium',
  hourCycle: 'h23',
  timeZone: 'UTC',
});
const relative = new Intl.RelativeTimeFormat(LOCALE, { numeric: 'always', style: 'narrow' });

const UNITS: readonly (readonly [Intl.RelativeTimeFormatUnit, number])[] = [
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
];

export class TimeLabels {
  static clock(iso: string, now: Date = new Date()): string {
    const date = TimeLabels.parse(iso);
    if (date === undefined) {
      return iso;
    }
    return TimeLabels.sameDay(date, now) ? clock.format(date) : dayAndClock.format(date);
  }

  static asOf(iso: string, now: Date = new Date()): string {
    const date = TimeLabels.parse(iso);
    if (date === undefined) {
      return iso;
    }
    return TimeLabels.sameDay(date, now) ? clockWithSeconds.format(date) : dayAndClock.format(date);
  }

  static precise(iso: string, now: Date = new Date()): string {
    const date = TimeLabels.parse(iso);
    if (date === undefined) {
      return iso;
    }
    return TimeLabels.sameDay(date, now)
      ? preciseClock.format(date)
      : dayAndPreciseClock.format(date);
  }

  static relative(iso: string, now: Date = new Date()): string {
    const date = TimeLabels.parse(iso);
    if (date === undefined) {
      return '';
    }
    const elapsed = date.getTime() - now.getTime();
    for (const [unit, size] of UNITS) {
      if (Math.abs(elapsed) >= size) {
        return relative.format(Math.round(elapsed / size), unit);
      }
    }
    return elapsed >= 0 ? 'in under a minute' : 'just now';
  }

  static tooltip(iso: string): string {
    const date = TimeLabels.parse(iso);
    return date === undefined ? iso : `${local.format(date)} · ${utc.format(date)} UTC`;
  }

  private static parse(iso: string): Date | undefined {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }

  private static sameDay(left: Date, right: Date): boolean {
    return left.toDateString() === right.toDateString();
  }
}
