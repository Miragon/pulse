<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue"

type Vital = "running" | "incidents" | "jobs"
interface Beat {
  start: number
  vital: Vital
  height: number
  length: number
}

const WIDTH = 1800
const SAMPLES_PER_FRAME = 6
const GAP = 40

const readouts = ref({ running: 144, incidents: 3, jobs: 2 })
const lit = ref<Vital | null>(null)
const canvas = ref<HTMLCanvasElement>()
let frameRequest = 0
let litTimer: ReturnType<typeof setTimeout> | undefined
let clock = 0
let beat = nextBeat(120)

function between(low: number, high: number) {
  return low + Math.random() * (high - low)
}

function pickVital(): Vital {
  const roll = Math.random()
  if (roll < 0.2) return "incidents"
  if (roll < 0.45) return "jobs"
  return "running"
}

function nextBeat(after: number): Beat {
  const vital = pickVital()
  const height =
    vital === "incidents"
      ? between(0.85, 1)
      : vital === "jobs"
        ? between(0.55, 0.75)
        : between(0.3, 0.5)
  return {
    start: after + Math.round(between(140, 420)),
    vital,
    height,
    length: Math.round(between(48, 72)),
  }
}

function beatShape(progress: number) {
  const wave = (from: number, to: number, size: number) =>
    progress >= from && progress < to
      ? size * Math.sin(((progress - from) / (to - from)) * Math.PI)
      : 0
  return wave(0, 0.15, -0.1) + wave(0.3, 0.45, -1) + wave(0.45, 0.6, 0.9) + wave(0.8, 1, -0.18)
}

function changeReadout(vital: Vital) {
  const values = readouts.value
  if (vital === "running") values.running += Math.random() < 0.6 ? 1 : -1
  if (vital === "jobs") values.jobs = values.jobs === 2 ? 3 : 2
  if (vital === "incidents") values.incidents = values.incidents === 3 ? 4 : 3
  lit.value = vital
  clearTimeout(litTimer)
  litTimer = setTimeout(() => (lit.value = null), 1400)
}

function sample(announce: boolean) {
  clock++
  if (clock >= beat.start + beat.length) beat = nextBeat(clock)
  if (clock < beat.start) return Math.sin(clock * 0.05) * 0.012
  if (announce && clock === beat.start + Math.round(beat.length / 2)) changeReadout(beat.vital)
  return beatShape((clock - beat.start) / beat.length) * beat.height
}

function draw(context: CanvasRenderingContext2D, line: (number | null)[], head: number) {
  const { width, height } = context.canvas
  const middle = height / 2
  const color = getComputedStyle(context.canvas).color
  const y = (value: number) => middle + value * middle * 0.85
  context.clearRect(0, 0, width, height)
  context.lineWidth = 3.5
  context.lineJoin = "round"
  context.strokeStyle = color
  context.beginPath()
  let drawing = false
  line.forEach((value, x) => {
    if (value === null) {
      drawing = false
      return
    }
    if (drawing) context.lineTo((x / WIDTH) * width, y(value))
    else context.moveTo((x / WIDTH) * width, y(value))
    drawing = true
  })
  context.stroke()
  context.fillStyle = color
  context.beginPath()
  context.arc(
    ((head - 1) / WIDTH) * width,
    y(line[(head - 1 + WIDTH) % WIDTH] ?? 0),
    7,
    0,
    Math.PI * 2,
  )
  context.fill()
}

onMounted(() => {
  const context = canvas.value?.getContext("2d")
  if (!context) return
  const line: (number | null)[] = Array.from({ length: WIDTH }, () => sample(false))
  let head = Math.round(WIDTH * 0.9)
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches)
    return draw(context, line, head)
  const tick = () => {
    for (let step = 0; step < SAMPLES_PER_FRAME; step++) {
      line[head] = sample(true)
      for (let ahead = 1; ahead <= GAP; ahead++) line[(head + ahead) % WIDTH] = null
      head = (head + 1) % WIDTH
    }
    draw(context, line, head)
    frameRequest = requestAnimationFrame(tick)
  }
  tick()
})

onBeforeUnmount(() => {
  cancelAnimationFrame(frameRequest)
  clearTimeout(litTimer)
})
</script>

<template>
  <div class="vitals">
    <canvas ref="canvas" class="trace" width="2240" height="280" aria-hidden="true" />
    <dl class="readouts" aria-label="Sample vital signs of an engine">
      <div :class="{ lit: lit === 'running' }">
        <dt>Running</dt>
        <dd>{{ readouts.running }}</dd>
      </div>
      <div :class="{ lit: lit === 'incidents' }">
        <dt>Incidents</dt>
        <dd :class="{ danger: readouts.incidents > 3 }">{{ readouts.incidents }}</dd>
      </div>
      <div :class="{ lit: lit === 'jobs' }">
        <dt>Jobs without retries</dt>
        <dd>{{ readouts.jobs }}</dd>
      </div>
    </dl>
  </div>
</template>

<style scoped>
.vitals {
  display: contents;
}
.trace {
  grid-area: trace;
  display: block;
  width: 100%;
  height: 132px;
  color: var(--cd-ui-icon-akzent);
}
.readouts {
  grid-area: readouts;
  display: grid;
  grid-template-rows: repeat(3, 1fr);
  margin: 0;
  border-left: 1px solid var(--cd-ui-linie);
}
.readouts > div {
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 16px 28px;
  transition: background-color var(--cd-motion-slow) var(--cd-ease);
}
.readouts > div + div {
  border-top: 1px solid var(--cd-ui-linie);
}
.readouts > div.lit {
  background: var(--cd-ui-abschnitt);
}
dt {
  font: 500 12px/1.4 var(--vp-font-family-mono);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--cd-ui-text-leise);
}
dd {
  margin: 4px 0 0;
  font: 600 36px/1.1 var(--vp-font-family-mono);
  font-variant-numeric: tabular-nums;
  color: var(--cd-ui-text);
}
dd.danger {
  color: var(--cd-ui-danger);
}
@media (max-width: 760px) {
  .readouts {
    grid-template-rows: none;
    grid-template-columns: repeat(3, 1fr);
    border-left: 0;
    border-top: 1px solid var(--cd-ui-linie);
  }
  .readouts > div + div {
    border-top: 0;
    border-left: 1px solid var(--cd-ui-linie);
  }
}
@media (max-width: 640px) {
  dd {
    font-size: 28px;
  }
  .readouts > div {
    padding: 14px 8px;
  }
}
</style>
