import { readFileSync } from "node:fs"

const PAYMENT_SOURCES = "sandbox/src/main/java/io/miragon/shop/payment"

function lineOf(fileName, snippet) {
  const source = readFileSync(`${PAYMENT_SOURCES}/${fileName}`, "utf8").split("\n")
  const index = source.findIndex((line) => line.includes(snippet))
  if (index < 0) {
    throw new Error(`${fileName} no longer contains "${snippet}".`)
  }
  return index + 1
}

function frame(className, method, line) {
  const fileName = `${className.split(".").at(-1)}.java`
  return `\tat ${className}.${method}(${fileName}:${line})`
}

const WORKER = "io.miragon.shop.payment.ChargePaymentWorker"
const GATEWAY = "io.miragon.shop.payment.CardGateway"
const CLIENT_FRAMES = [
  "\tat org.operaton.bpm.client.topic.impl.TopicSubscriptionManager.handleExternalTask(TopicSubscriptionManager.java:152)",
  "\tat org.operaton.bpm.client.topic.impl.TopicSubscriptionManager.lambda$acquire$0(TopicSubscriptionManager.java:108)",
  "\tat java.base/java.util.Arrays$ArrayList.forEach(Arrays.java:4305)",
  "\tat org.operaton.bpm.client.topic.impl.TopicSubscriptionManager.acquire(TopicSubscriptionManager.java:103)",
  "\tat org.operaton.bpm.client.topic.impl.TopicSubscriptionManager.run(TopicSubscriptionManager.java:89)",
  "\tat java.base/java.lang.Thread.run(Thread.java:1583)",
]

export function cardExpiredTrace(businessKey, message) {
  return [
    `io.miragon.shop.payment.PaymentFailedException: Payment for order ${businessKey} failed`,
    frame(WORKER, "charge", lineOf("ChargePaymentWorker.java", "throw new PaymentFailedException")),
    frame(WORKER, "execute", lineOf("ChargePaymentWorker.java", "charge(task);")),
    ...CLIENT_FRAMES,
    `Caused by: io.miragon.shop.payment.CardExpiredException: ${message}`,
    frame(GATEWAY, "authorize", lineOf("CardGateway.java", "throw new CardExpiredException")),
    frame(WORKER, "charge", lineOf("ChargePaymentWorker.java", "gateway.authorize(")),
    `\t... ${CLIENT_FRAMES.length + 1} more`,
  ].join("\n")
}

export function paypalTimeoutTrace(message) {
  return [
    `java.net.http.HttpTimeoutException: ${message}`,
    "\tat java.net.http/jdk.internal.net.http.HttpClientImpl.send(HttpClientImpl.java:950)",
    "\tat io.miragon.shop.payment.PayPalGateway.capture(PayPalGateway.java:58)",
    ...CLIENT_FRAMES,
  ].join("\n")
}

export function nodeErrorTrace(message) {
  return [
    `Error: ${message}`,
    "    at bookCarrier (/srv/shipping-worker/dist/carrier.js:23:11)",
    "    at async handleTask (/srv/shipping-worker/dist/worker.js:41:5)",
    "    at async Promise.all (index 0)",
  ].join("\n")
}
