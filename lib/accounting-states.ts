// Financial exposure follows posting events, not preparation/approval queues.
export function isOpenPayable(status: string) {
  return ["Approved Unpaid", "Payment Released"].includes(status);
}

export function isIssuedOwnerBilling(status: string) {
  return ["Sent", "Partially Paid", "Paid"].includes(status);
}

export function isOpenReceivable(status: string) {
  return ["Sent", "Partially Paid"].includes(status);
}
