export class SplitShare {
  static readonly MIN = 0.2;
  static readonly MAX = 0.8;

  static clamp(share: number): number {
    return Math.min(SplitShare.MAX, Math.max(SplitShare.MIN, share));
  }
}
