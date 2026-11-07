import { ProfileFileName } from "./profile-file-name.js"

export class TargetsProblem {
  constructor(
    readonly path: string,
    readonly message: string,
    readonly severity?: "warning",
  ) {}

  label(): string {
    return `${ProfileFileName.label(this.path)}: ${this.message}`
  }

  detail(): string {
    return `${this.path}: ${this.message}`
  }
}
