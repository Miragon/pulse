export class ScreenFrame {
  static readonly PLAIN = "grid h-full min-w-0 grid-rows-[auto_minmax(0,1fr)]"
  static readonly WITH_STRIPS = "grid h-full min-w-0 grid-rows-[auto_auto_minmax(0,1fr)]"
  static readonly STRIPS = "flex min-w-0 flex-col"
  static readonly LIST_REGION = "bg-card @container/list flex h-full min-h-0 flex-col"
}
