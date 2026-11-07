function orders(version, count, options = {}) {
  return { process: "order-fulfillment", version, count, variant: "regular", ...options }
}

function returns(count, options = {}) {
  return { process: "return-handling", version: 1, count, ...options }
}

const APPROVED = { variables: { approved: true } }
const REJECTED = { variables: { approved: false } }
const CHECKED = ["check"]
const PAID = ["check", "pay"]
const FULFILLED = ["check", "pay", "pack"]

export const SHOP_DEV_SCENARIOS = [
  orders(3, 117),
  orders(3, 3, {
    variant: "longNotes",
    localVariables: { reviewNote: "Call the customer before approving: the address looks odd." },
  }),
  orders(3, 8, { through: CHECKED, ...APPROVED }),
  orders(3, 4, { through: CHECKED, variant: "expiredCard", incidents: 1, ...APPROVED }),
  orders(3, 2, { through: CHECKED, variant: "paypalTimeout", ...APPROVED }),
  orders(3, 2, { through: PAID, variant: "legacyCustomer", incidents: 1, ...APPROVED }),
  orders(3, 5, { through: PAID, ...APPROVED }),
  orders(3, 3, { through: PAID, variant: "overweight", incidents: 1, ...APPROVED }),
  orders(3, 2, { through: CHECKED, incidents: 1 }),
  orders(3, 5, { through: CHECKED, ...REJECTED }),
  orders(3, 6, { through: FULFILLED, variables: { approved: true, pickupWait: "PT1S" } }),
  orders(3, 2, { through: CHECKED, variables: { approved: true, paymentWindow: "PT1S" } }),
  orders(3, 2, { cancel: true }),
  orders(2, 3),
  orders(2, 2, { through: CHECKED, ...APPROVED }),
  orders(2, 1, { through: CHECKED, variant: "expiredCard", incidents: 1, ...APPROVED }),
  orders(1, 2),
  orders(1, 1, { through: CHECKED, ...APPROVED }),
  returns(4),
  returns(1, { withoutBusinessKey: true }),
  returns(1, { through: ["label", "recall"] }),
  returns(3, { through: ["label"] }),
  returns(2, { through: ["label", "receive"] }),
  returns(3, { through: ["label", "receive", "inspect"] }),
]

export const SHOP_TEST_SCENARIOS = [
  orders(1, 5),
  orders(1, 2, { through: CHECKED, ...APPROVED }),
  orders(1, 1, { through: CHECKED, variant: "expiredCard", incidents: 1, ...APPROVED }),
  orders(1, 2, { through: CHECKED, ...REJECTED }),
  returns(1),
]
