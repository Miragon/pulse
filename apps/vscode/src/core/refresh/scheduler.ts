export type Cancel = () => void;

export interface Scheduler {
  schedule(delayMs: number, task: () => void): Cancel;
}
