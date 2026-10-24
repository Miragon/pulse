---
layout: home

hero:
  name: Miragon Pulse
  text: Ask your engines what is stuck and why.
  tagline: Pulse lets Claude, ChatGPT or any other MCP client read and operate your Camunda 7, CIB seven and Operaton engines. It starts read-only and answers with widgets in the chat.
  actions:
    - theme: brand
      text: Get started
      link: /getting-started
    - theme: alt
      text: Product page
      link: https://miragon.ai/tools/pulse/
    - theme: alt
      text: GitHub
      link: https://github.com/Miragon/pulse
---

## Try it, then run it on your engine

[Getting started](./getting-started.md) connects your Claude to the public playground with one
command, then runs the Docker image `ghcr.io/miragon/pulse-server` against your own engine's
REST API.
[Usage](./usage.md) covers the other assistants, what to ask and your settings.

## Run it for your team

[Operations](./operations.md) holds the image, the security model, every environment variable, the
toolsets that allow writes and the health routes. [Architecture](./architecture.md) shows the
server, its two modules (camunda7 and analytics) and the systems they talk to.

## Build on it

The [developer guide](./developer.md) runs the stack from source and composes the published
`@miragon/pulse-*` modules into a server of your own. The [CLI](./cli/index.md) brings the same
engines to a shell and to coding agents. Pulse is pre-1.0: minor releases can rename tools, so
pin a version from the [releases](https://github.com/Miragon/pulse/releases).
