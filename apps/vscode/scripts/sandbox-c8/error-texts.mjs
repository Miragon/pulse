import { readFileSync } from "node:fs"

const SOURCES = new URL("../../sandbox-c8/src/main/java/io/miragon/shop/", import.meta.url)
const CLIENT_FRAMES = [
  "\tat java.base/jdk.internal.reflect.DirectMethodHandleAccessor.invoke(DirectMethodHandleAccessor.java:103)",
  "\tat java.base/java.lang.reflect.Method.invoke(Method.java:580)",
  "\tat io.camunda.spring.client.bean.MethodInfo.invoke(MethodInfo.java:65)",
  "\tat io.camunda.spring.client.jobhandling.JobHandlerInvokingSpringBeans.handle(JobHandlerInvokingSpringBeans.java:73)",
  "\tat io.camunda.client.impl.worker.JobRunnableFactoryImpl.executeJob(JobRunnableFactoryImpl.java:45)",
  "\tat io.camunda.client.impl.worker.JobRunnableFactoryImpl.lambda$create$0(JobRunnableFactoryImpl.java:40)",
  "\tat java.base/java.util.concurrent.ThreadPoolExecutor.runWorker(ThreadPoolExecutor.java:1144)",
  "\tat java.base/java.util.concurrent.ThreadPoolExecutor$Worker.run(ThreadPoolExecutor.java:642)",
  "\tat java.base/java.lang.Thread.run(Thread.java:1583)",
]

function lineOf(path, snippet) {
  const source = readFileSync(new URL(path, SOURCES), "utf8").split("\n")
  const index = source.findIndex((line) => line.includes(snippet))
  if (index < 0) {
    throw new Error(`${path} no longer contains "${snippet}".`)
  }
  return index + 1
}

function frame(className, method, path, snippet) {
  const fileName = path.split("/").at(-1)
  return `\tat ${className}.${method}(${fileName}:${lineOf(path, snippet)})`
}

const WORKER = "io.miragon.shop.payment.ChargePaymentWorker"
const WORKER_SOURCE = "payment/ChargePaymentWorker.java"

export function cardExpiredText(orderId, message) {
  return [
    `io.miragon.shop.payment.PaymentFailedException: Payment for order ${orderId} failed`,
    frame(WORKER, "charge", WORKER_SOURCE, "throw new PaymentFailedException"),
    frame(WORKER, "chargePayment", WORKER_SOURCE, "= charge("),
    ...CLIENT_FRAMES,
    `Caused by: io.miragon.shop.payment.CardExpiredException: ${message}`,
    frame(
      "io.miragon.shop.payment.CardGateway",
      "authorize",
      "payment/CardGateway.java",
      "throw new CardExpiredException",
    ),
    frame(WORKER, "charge", WORKER_SOURCE, "gateway.authorize("),
    `\t... ${CLIENT_FRAMES.length + 1} more`,
  ].join("\n")
}

export function paypalTimeoutText(message) {
  return [
    `java.net.http.HttpTimeoutException: ${message}`,
    "\tat java.net.http/jdk.internal.net.http.HttpClientImpl.send(HttpClientImpl.java:950)",
    "\tat io.miragon.shop.payment.PayPalGateway.capture(PayPalGateway.java:58)",
    ...CLIENT_FRAMES,
  ].join("\n")
}

export function carrierRejectedText(message) {
  return [
    `io.miragon.shop.shipping.CarrierRejectedException: ${message}`,
    frame(
      "io.miragon.shop.shipping.BookCarrierWorker",
      "bookCarrier",
      "shipping/BookCarrierWorker.java",
      "throw new CarrierRejectedException",
    ),
    ...CLIENT_FRAMES,
  ].join("\n")
}
