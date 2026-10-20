/* A confirmed Prep payment, counted once without sending an order ID or buyer data. */
export async function reportPaidOrder(pending, result, track, storage = localStorage, cryptoApi = crypto) {
  if (result.status !== "paid" || !pending.order_id) return;
  try {
    const bytes = await cryptoApi.subtle.digest("SHA-256", new TextEncoder().encode(String(pending.order_id)));
    const transaction = "prep_" + Array.from(new Uint8Array(bytes)).map(b => b.toString(16).padStart(2, "0")).join("");
    const key = "ps_purchase_" + transaction;
    try { if (storage.getItem(key)) return; } catch (_) { /* GA4 can deduplicate the transaction. */ }
    const payload = { product: "prep-sarthi", plan: result.plan, transaction_id: transaction };
    // Amount/currency came from the server when this order was created. Never guess
    // the paid amount from a price table or reuse values from another order.
    if (Number.isFinite(pending.amount) && pending.amount > 0 && /^[A-Z]{3}$/.test(pending.currency || "")) {
      payload.value = pending.amount;
      payload.currency = pending.currency;
      payload.items = [{ item_id: "prep_pass", item_name: "Prep Sarthi pass", price: pending.amount, quantity: 1 }];
    }
    track("purchase", payload);
    if (["demo_call", "demo_exit"].includes(pending.where)) track("mock_offer_paid", { where: pending.where });
    try { storage.setItem(key, "1"); } catch (_) { /* storage may be blocked */ }
  } catch (_) { /* Analytics must never interrupt payment confirmation. */ }
}
