import { ProfileSource } from "./profile-source.js"

export class TargetsProblem {
  constructor(
    readonly path: string,
    readonly message: string,
    readonly severity?: "warning",
    readonly source: ProfileSource = ProfileSource.PROJECT,
  ) {}

  label(): string {
    return `${this.source.label(this.path)}: ${this.message}`
  }

  detail(): string {
    return `${this.path}: ${this.message}`
  }
}
