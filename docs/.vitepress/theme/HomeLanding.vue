<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from "vue"
import { withBase } from "vitepress"
import VitalSigns from "./VitalSigns.vue"

const terminal = [
  [
    { text: "~/shop", tone: "prompt" },
    { text: " $ ", tone: "quiet" },
    { text: "pulse-cli status" },
  ],
  [{ text: "Status   " }, { text: "4 incidents", tone: "danger" }],
  [],
  [{ text: "Incidents by root cause:" }],
  [{ text: "4", tone: "danger" }, { text: "  order-fulfillment · Charge payment" }],
  [{ text: "   CardExpiredException", tone: "quiet" }],
  [{ text: "   next: " }, { text: "pulse-cli inspect --business-key ORD-10131", tone: "accent" }],
  [],
  [
    { text: "~/shop", tone: "prompt" },
    { text: " $ ", tone: "quiet" },
    { text: "pulse-cli retry --business-key ORD-10131 --now" },
  ],
  [{ text: "Retried", tone: "accent" }, { text: " 1 job · incident resolved" }],
]

const clients = [
  {
    name: "AI chat",
    title: "AI chat · pulse",
    effect: "Claude, ChatGPT or any other MCP client asks, Pulse answers with the incident.",
    action: "https://pulse-playground.miragon.ai/mcp",
    link: "/mcp/getting-started",
  },
  {
    name: "Terminal",
    title: "Terminal · pulse-cli",
    effect: "Triage the whole engine in one read-only call, then fix it.",
    action: "npm install -g @miragon/pulse-cli",
    link: "/cli/getting-started",
  },
  {
    name: "VS Code",
    title: "VS Code · Order fulfillment",
    effect: "The runtime on your model, the root cause next to your code.",
    action: "code --install-extension miragon-gmbh.pulse --pre-release",
    link: "/vscode/installation",
    beta: true,
  },
]

const active = ref(0)
const tabButtons = ref<HTMLButtonElement[]>([])

const held = ref(false)
const cycling = ref(false)
const round = ref(0)
let timer: ReturnType<typeof setInterval> | undefined

function restartClock() {
  clearInterval(timer)
  round.value++
  timer = setInterval(() => {
    if (held.value) return
    active.value = (active.value + 1) % clients.length
    round.value++
  }, 6000)
}

function release() {
  held.value = false
  if (cycling.value) restartClock()
}

function choose(index: number) {
  active.value = index
  if (cycling.value) restartClock()
}

onMounted(() => {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
  cycling.value = true
  restartClock()
})
onBeforeUnmount(() => clearInterval(timer))

async function moveBy(offset: number) {
  if (cycling.value) restartClock()
  active.value = (active.value + offset + clients.length) % clients.length
  await nextTick()
  tabButtons.value[active.value]?.focus()
}
</script>

<template>
  <div class="landing">
    <section class="monitor">
      <div class="head">
        <div class="pitch">
          <p class="engine"><span class="live" />playground · CIB seven · live</p>
          <h1>Pulse.</h1>
          <p class="lede">
            Your engine's vital signs, in your AI chat, your terminal and your editor. For Camunda
            7, CIB seven and Operaton, read-only until you allow more.
          </p>
          <p class="status">
            <span class="square" />Pre-1.0: pin the version, a minor release can rename a tool or a
            command.
          </p>
        </div>
      </div>
      <VitalSigns />
    </section>

    <section
      class="window"
      @mouseenter="held = true"
      @mouseleave="release"
      @focusin="held = true"
      @focusout="release"
    >
      <div class="bar">
        <span class="dots"><i /><i /><i /></span>
        <div class="tabs" role="tablist" aria-label="Clients">
          <button
            v-for="(client, index) in clients"
            :key="client.name"
            ref="tabButtons"
            role="tab"
            :id="`client-tab-${index}`"
            :aria-selected="active === index"
            :aria-controls="`client-panel-${index}`"
            :tabindex="active === index ? 0 : -1"
            :class="{
              on: active === index,
              running: active === index && cycling && !held && !chosen,
            }"
            @click="choose(index)"
            @keydown.right.prevent="moveBy(1)"
            @keydown.left.prevent="moveBy(-1)"
          >
            <span :key="round" class="progress" />{{ client.name
            }}<span v-if="client.beta" class="tag">beta</span>
          </button>
        </div>
      </div>

      <div class="panels">
        <div
          v-for="(client, index) in clients"
          :key="client.name"
          :id="`client-panel-${index}`"
          role="tabpanel"
          :aria-labelledby="`client-tab-${index}`"
          class="panel"
          :class="{ shown: active === index }"
        >
          <div v-if="index === 0" class="screen chat">
            <aside class="chats">
              <span class="new-chat">New chat</span>
              <span class="label">Recent</span>
              <span class="recent on">Why is ORD-10131 stuck?</span>
              <span class="recent">Incidents on shop-dev today</span>
              <span class="recent">Migrate order fulfillment to v3</span>
              <span class="recent">Slowest step in returns</span>
            </aside>
            <div class="conversation">
              <div class="thread">
                <p class="ask">Why is order ORD-10131 stuck?</p>
                <div class="reply">
                  <span class="avatar" aria-hidden="true" />
                  <div class="reply-body">
                    <p class="call">Used pulse · show incident detail</p>
                    <img
                      class="widget light-only"
                      :src="withBase('/landing/chat-widget-light.png')"
                      alt="The incident widget: Charge payment failed because the card expired, with a Retry task button"
                    />
                    <img
                      class="widget dark-only"
                      :src="withBase('/landing/chat-widget-dark.png')"
                      alt="The incident widget: Charge payment failed because the card expired, with a Retry task button"
                    />
                    <p class="answer">
                      The card expired. Update <code>cardExpiry</code> and retry the task.
                    </p>
                  </div>
                </div>
              </div>
              <div class="composer">
                <span>Ask about your processes</span>
                <span class="send" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="16" height="16">
                    <path d="m5 12 7-7 7 7M12 19V5" />
                  </svg>
                </span>
              </div>
            </div>
          </div>
          <div v-else-if="index === 1" class="screen terminal">
            <div class="term-bar">zsh — ~/shop</div>
            <div class="term-body">
              <div v-for="(line, at) in terminal" :key="at">
                <span v-for="(part, from) in line" :key="from" :class="part.tone">{{
                  part.text
                }}</span
                >&#8203;
              </div>
              <div>
                <span class="prompt">~/shop</span> <span class="quiet">$</span>
                <span class="cursor" />
              </div>
            </div>
          </div>
          <div v-else class="screen editor">
            <img
              class="light-only"
              :src="withBase('/landing/vscode-light.png')"
              alt="Pulse in VS Code: the Engines view and the deployed order process with incident badges on Charge payment and its instances"
            />
            <img
              class="dark-only"
              :src="withBase('/landing/vscode-dark.png')"
              alt="Pulse in VS Code: the Engines view and the deployed order process with incident badges on Charge payment and its instances"
            />
          </div>

          <a class="footer" :href="withBase(client.link)">
            <span class="effect">{{ client.effect }}</span>
            <code>{{ client.action }}</code>
          </a>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.landing {
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-height: calc(100vh - var(--vp-nav-height, 64px) - 64px);
  max-width: 1120px;
  margin: 0 auto;
  padding: 32px 24px 48px;
  color: var(--cd-ui-text);
}
.monitor,
.window {
  border: 1px solid var(--cd-ui-linie);
  border-radius: var(--cd-radius-md);
  background: var(--cd-ui-flaeche);
  overflow: hidden;
}
.monitor {
  display: grid;
  grid-template-columns: 1fr 260px;
  grid-template-areas:
    "head readouts"
    "trace readouts";
}
.head {
  grid-area: head;
  padding: 32px 36px 0;
}
h1 {
  margin: 0;
  padding: 0;
  border: 0;
  font-size: 76px;
  line-height: 0.9;
  font-weight: 700;
  letter-spacing: -0.06em;
  color: var(--cd-ui-text);
}
.lede {
  max-width: 60ch;
  margin: 12px 0 0;
  font-size: 17px;
  line-height: 1.55;
  color: var(--cd-ui-text-leise);
}
.status {
  margin: 10px 0 0;
  font-size: 13px;
  color: var(--cd-ui-text-leise);
}
.square {
  display: inline-block;
  width: 8px;
  height: 8px;
  margin-right: 8px;
  background: var(--cd-ui-warning);
}
.engine {
  margin: 0 0 12px;
  font: 500 12px/1.4 var(--vp-font-family-mono);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--cd-ui-text-leise);
}
.live {
  display: inline-block;
  width: 7px;
  height: 7px;
  margin-right: 8px;
  border-radius: 50%;
  background: var(--cd-ui-icon-akzent);
  animation: blink 1.2s infinite;
}
@keyframes blink {
  50% {
    opacity: 0.25;
  }
}
.window {
  margin-top: 24px;
}
.bar {
  display: flex;
  align-items: flex-end;
  gap: 16px;
  padding: 0 14px;
  border-bottom: 1px solid var(--cd-ui-linie);
  background: var(--cd-ui-abschnitt);
}
.dots {
  display: flex;
  gap: 6px;
  align-self: center;
}
.dots i {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--cd-ui-linie);
}
.tabs {
  display: flex;
}
.tabs button {
  position: relative;
  margin-bottom: -1px;
  padding: 10px 18px;
  border: 1px solid transparent;
  border-bottom: 0;
  border-radius: var(--cd-radius-sm) var(--cd-radius-sm) 0 0;
  font-size: 14px;
  font-weight: 500;
  color: var(--cd-ui-text-leise);
}
.tabs button.on.running {
  box-shadow: inset 0 2px var(--cd-ui-linie);
}
.progress {
  display: none;
}
.tabs button.running .progress {
  display: block;
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 2px;
  background: var(--cd-ui-interaktion);
  transform-origin: left;
  animation: fill 6s linear;
}
@keyframes fill {
  from {
    transform: scaleX(0);
  }
  to {
    transform: scaleX(1);
  }
}
.tabs button:hover {
  color: var(--cd-ui-text);
}
.tabs button.on {
  border-color: var(--cd-ui-linie);
  background: var(--cd-ui-flaeche);
  color: var(--cd-ui-text);
  box-shadow: inset 0 2px var(--cd-ui-interaktion);
}
.tabs button:focus-visible {
  outline: 2px solid var(--cd-ui-fokus);
  outline-offset: -2px;
}
.tag {
  margin-left: 8px;
  font: 500 11px var(--vp-font-family-mono);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--cd-ui-text-leise);
}
.panels {
  display: grid;
}
.panel {
  grid-area: 1 / 1;
  visibility: hidden;
}
.panel.shown {
  visibility: visible;
}
.screen {
  height: clamp(300px, calc(100vh - 580px), 600px);
  overflow: hidden;
}
.quiet {
  color: var(--cd-ui-text-leise);
}
.danger {
  color: var(--cd-ui-danger);
}
.accent {
  color: var(--cd-ui-link);
}
.prompt {
  color: var(--cd-ui-icon-akzent);
}
.chat {
  display: grid;
  grid-template-columns: 220px 1fr;
  font-size: 14px;
  line-height: 1.5;
}
.chats {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 16px 12px;
  border-right: 1px solid var(--cd-ui-linie);
  background: var(--cd-ui-abschnitt);
  font-size: 13px;
}
.new-chat {
  margin-bottom: 14px;
  padding: 8px 12px;
  border: 1px solid var(--cd-ui-linie);
  border-radius: var(--cd-radius-md);
  background: var(--cd-ui-flaeche);
  font-weight: 600;
}
.chats .label {
  padding: 0 12px 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--cd-ui-text-leise);
}
.recent {
  padding: 6px 12px;
  overflow: hidden;
  border-radius: var(--cd-radius-sm);
  white-space: nowrap;
  text-overflow: ellipsis;
}
.recent.on {
  background: var(--cd-ui-hover);
}
.conversation {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 0;
  padding: 10px 32px 10px;
}
.thread {
  display: flex;
  flex-direction: column;
  justify-content: center;
  flex: 1;
  width: 100%;
  max-width: 640px;
  min-width: 0;
}
.chat p {
  margin: 0;
}
.chat .ask {
  max-width: 80%;
  align-self: flex-end;
  padding: 6px 14px;
  border-radius: 18px;
  background: var(--cd-ui-hover);
}
.reply {
  display: flex;
  gap: 12px;
  margin-top: 6px;
}
.avatar {
  flex: none;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: var(--cd-ui-icon-akzent);
}
.reply-body {
  min-width: 0;
}
.chat .call {
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
  line-height: 26px;
  color: var(--cd-ui-text-leise);
}
.widget {
  width: 100%;
  max-width: 280px;
  margin-top: 6px;
  border: 1px solid var(--cd-ui-linie);
  border-radius: var(--cd-radius-md);
}
.chat .answer {
  margin-top: 8px;
}
.chat .answer code {
  font-size: 12.5px;
}
.composer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  max-width: 640px;
  padding: 8px 8px 8px 16px;
  border: 1px solid var(--cd-ui-linie);
  border-radius: 20px;
  background: var(--cd-ui-flaeche);
  color: var(--cd-ui-text-leise);
}
.send {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: var(--cd-ui-text);
  color: var(--cd-ui-flaeche);
}
.send svg {
  fill: none;
  stroke: currentColor;
  stroke-width: 2.5;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.terminal {
  display: flex;
  flex-direction: column;
  background: var(--cd-ui-grund);
  font-family: var(--vp-font-family-mono);
}
.term-bar {
  padding: 8px 16px;
  border-bottom: 1px solid var(--cd-ui-linie);
  text-align: center;
  font-size: 12px;
  color: var(--cd-ui-text-leise);
}
.term-body {
  padding: 20px 32px;
  font-size: 15px;
  line-height: 1.75;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.cursor {
  display: inline-block;
  margin-left: 8px;
  width: 9px;
  height: 18px;
  vertical-align: text-bottom;
  background: var(--cd-ui-text);
  animation: blink 1.1s steps(1) infinite;
}
.editor img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: top left;
}
.footer {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 8px 24px;
  padding: 10px 20px;
  border-top: 1px solid var(--cd-ui-linie);
  color: inherit;
  text-decoration: none;
  font-size: 14px;
}
.effect {
  color: var(--cd-ui-text-leise);
}
.footer code {
  padding: 0;
  background: none;
  font-size: 13px;
  color: var(--cd-ui-link);
  overflow-wrap: anywhere;
}
@media (min-height: 1000px) {
  .widget {
    max-width: 400px;
  }
}
@media (min-height: 1150px) {
  .widget {
    max-width: 480px;
  }
}
@media (max-width: 760px) {
  .monitor {
    grid-template-columns: 1fr;
    grid-template-areas: "head" "trace" "readouts";
  }
  .head {
    padding: 20px 20px 0;
  }
  h1 {
    font-size: 64px;
  }
  .tabs button {
    padding: 10px 12px;
  }
  .dots {
    display: none;
  }
  .screen {
    aspect-ratio: auto;
    height: 440px;
  }
  .chat {
    grid-template-columns: 1fr;
    font-size: 13px;
  }
  .chats {
    display: none;
  }
  .conversation {
    padding: 16px;
  }
  .term-body {
    padding: 14px;
    font-size: 12px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .live,
  .cursor {
    animation: none;
  }
}
</style>

<style>
.landing .dark-only {
  display: none;
}
.dark .landing .dark-only {
  display: block;
}
.dark .landing .light-only {
  display: none;
}
</style>
