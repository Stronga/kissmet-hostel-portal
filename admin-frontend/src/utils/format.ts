export function formatCurrencyMinor(value: number | null | undefined, currency = "GHS") {
  const amount = Number(value ?? 0) / 100;
  return `${currency} ${new Intl.NumberFormat("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount)}`;
}

export function formatStatus(status: string | null | undefined) {
  if (!status) return "Unknown";
  return status.split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}
