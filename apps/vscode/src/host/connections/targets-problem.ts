import { basename } from 'node:path';

export class TargetsProblem {
  constructor(
    readonly path: string,
    readonly message: string,
  ) {}

  label(): string {
    return `${basename(this.path)}: ${this.message}`;
  }

  detail(): string {
    return `${this.path}: ${this.message}`;
  }
}
