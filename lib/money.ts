/** Rupees to a short label: ₹1.50 Cr, ₹30.00 L, or plain rupees. */
export function formatMoney(amount: number): string {
  if (amount >= 10000000) return `₹${(amount / 10000000).toFixed(2)} Cr`
  if (amount >= 100000) return `₹${(amount / 100000).toFixed(2)} L`
  return `₹${amount}`
}
