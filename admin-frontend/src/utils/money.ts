export function parseMoneyToMinorUnits(value: string) {
  const trimmed = value.trim().replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) throw new Error("Enter a valid amount with up to two decimal places.");
  const [whole, cents = ""] = trimmed.split(".");
  return Number.parseInt(whole, 10) * 100 + Number.parseInt(cents.padEnd(2, "0") || "0", 10);
}
