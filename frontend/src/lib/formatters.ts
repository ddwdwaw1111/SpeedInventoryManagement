const usdMoneyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

const decimalNumberFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

const integerNumberFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2
});

export function formatMoney(value: number) {
  return usdMoneyFormatter.format(value);
}

export function formatDiscountMoney(value: number) {
  return value === 0 ? formatMoney(0) : formatMoney(-Math.abs(value));
}

export function formatNumber(value: number) {
  return (Number.isInteger(value) ? integerNumberFormatter : decimalNumberFormatter).format(value);
}

export function formatSignedNumber(value: number) {
  if (value > 0) {
    return `+${formatNumber(value)}`;
  }
  return formatNumber(value);
}
