const CUSTOMERS = [
  customer("C-1001", "Ada Lovelace", "gold", ["Marienplatz 1", "80331", "München", "DE"]),
  customer("C-1002", "Grace Hopper", "silver", ["Jungfernstieg 7", "20354", "Hamburg", "DE"]),
  customer("C-1003", "Alan Turing", "bronze", ["Stephansplatz 3", "1010", "Wien", "AT"]),
  customer("C-1004", "Katherine Johnson", "gold", ["Bahnhofstrasse 12", "8001", "Zürich", "CH"]),
  customer("C-1005", "Edsger Dijkstra", "silver", ["Dam 1", "1012 JS", "Amsterdam", "NL"]),
  customer("C-1006", "Barbara Liskov", "bronze", ["Unter den Linden 5", "10117", "Berlin", "DE"]),
]
const LEGACY_CUSTOMER = customer("C-0042", "Konrad Zuse", "legacy", [
  "Zuse-Platz 1",
  "36088",
  "Hünfeld",
  "DE",
])

const MUG = { sku: "MUG-001", title: "Miragon mug", price: 12.9, weightKg: 0.4 }
const HOODIE = { sku: "HOOD-002", title: "Hoodie", price: 49.9, weightKg: 0.7 }
const BOOK = { sku: "BOOK-003", title: "Real-Life BPMN", price: 39.9, weightKg: 0.9 }
const CHAIR = { sku: "CHAIR-004", title: "Ergonomic chair", price: 1249, weightKg: 18.5 }
const DESK = { sku: "DESK-005", title: "Standing desk", price: 689, weightKg: 32.5 }
const SMALL_BASKETS = [[MUG], [HOODIE, MUG], [BOOK], [BOOK, HOODIE, MUG], [MUG, MUG, BOOK]]

const SHIPPING_FEE = 4.95
const PACKAGING_KG = 0.25
const FIRST_ERP_NUMBER = 9_007_199_254_740_993n
const LONG_NOTE =
  "Customer called about the delivery date and asked to leave the parcel with the neighbour. "

function customer(id, name, tier, [street, zip, city, country]) {
  const email = `${name.toLowerCase().replaceAll(" ", ".")}@example.com`
  return { id, name, tier, email, address: { street, zip, city, country } }
}

function rounded(value, digits) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function lines(products) {
  const bySku = Map.groupBy(products, (product) => product.sku)
  return [...bySku.values()].map(([product, ...more]) => ({
    sku: product.sku,
    title: product.title,
    quantity: 1 + more.length,
    price: product.price,
  }))
}

function cardLast4(index) {
  return String(1000 + ((index * 37) % 9000))
}

const PAYMENTS = {
  regular: (index) =>
    [
      { paymentMethod: "card", cardLast4: cardLast4(index), cardExpiry: "12/2029" },
      { paymentMethod: "invoice" },
      { paymentMethod: "paypal" },
    ][index % 3],
  expiredCard: (index) => ({
    paymentMethod: "card",
    cardLast4: cardLast4(index),
    cardExpiry: "03/2025",
  }),
  paypalTimeout: () => ({ paymentMethod: "paypal" }),
}

const VARIANTS = {
  regular: { basket: (index) => SMALL_BASKETS[index % SMALL_BASKETS.length] },
  expiredCard: { payment: PAYMENTS.expiredCard },
  paypalTimeout: { basket: () => [CHAIR], payment: PAYMENTS.paypalTimeout },
  legacyCustomer: { customer: () => LEGACY_CUSTOMER },
  overweight: { basket: () => [DESK, BOOK] },
  longNotes: { notes: () => LONG_NOTE.repeat(40) },
}

function variantOf(name) {
  const variant = VARIANTS[name]
  if (variant === undefined) {
    throw new Error(`Unknown order variant "${name}".`)
  }
  return {
    customer: (index) => CUSTOMERS[index % CUSTOMERS.length],
    basket: VARIANTS.regular.basket,
    payment: PAYMENTS.regular,
    notes: () => undefined,
    ...variant,
  }
}

function basketFacts(products) {
  const total = products.reduce((sum, product) => sum + product.price, SHIPPING_FEE)
  const weight = products.reduce((sum, product) => sum + product.weightKg, PACKAGING_KG)
  return {
    items: lines(products),
    itemCount: products.length,
    amount: rounded(total, 2),
    weightKg: rounded(weight, 2),
    parcelCount: Math.ceil(products.length / 2),
  }
}

export function orderVariables(index, variantName) {
  const variant = variantOf(variantName)
  const buyer = variant.customer(index)
  const notes = variant.notes(index)
  return {
    customer: buyer,
    customerTier: buyer.tier,
    ...basketFacts(variant.basket(index)),
    currency: "EUR",
    ...variant.payment(index),
    express: index % 4 === 0,
    orderedAt: new Date(Date.now() - index * 7 * 60_000),
    couponCode: index % 5 === 0 ? "WELCOME10" : null,
    erpOrderNumber: FIRST_ERP_NUMBER + BigInt(index),
    ...(notes === undefined ? {} : { notes }),
  }
}

export function returnVariables(index) {
  const buyer = CUSTOMERS[index % CUSTOMERS.length]
  return {
    customer: buyer,
    orderReference: `ORD-${String(10_001 + index)}`,
    reason: ["Wrong size", "Damaged on arrival", "No longer needed"][index % 3],
    refundAmount: rounded(SMALL_BASKETS[index % SMALL_BASKETS.length][0].price, 2),
  }
}
