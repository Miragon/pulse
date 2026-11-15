export interface BatchRef {
  readonly id: string
}

export interface TransitionInstanceView {
  readonly id: string
  readonly activityId: string
}

export interface ActivityInstanceView {
  readonly id: string
  readonly activityId: string
  readonly childActivityInstances: readonly ActivityInstanceView[]
  readonly childTransitionInstances: readonly TransitionInstanceView[]
}
