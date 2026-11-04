/**
 * Money in Kiota is always an integer number of cents (KES 1 = 100 cents).
 * Format only at the edge, for display.
 */
export function formatKes(cents: number): string {
  if (!Number.isInteger(cents)) {
    throw new Error(`Money must be integer cents, got ${cents}`);
  }
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const shillings = Math.floor(abs / 100).toLocaleString("en-KE");
  const rest = String(abs % 100).padStart(2, "0");
  return `${sign}KES ${shillings}.${rest}`;
}
