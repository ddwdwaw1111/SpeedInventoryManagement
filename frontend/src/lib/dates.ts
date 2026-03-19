export function parseDateValue(value: string) {
  const trimmed = value.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T00:00:00(?:\.000)?Z)?$/.exec(trimmed);

  if (match) {
    const [, year, month, day] = match;
    return new Date(Number(year), Number(month) - 1, Number(day));
  }

  return new Date(trimmed);
}

export function formatDateValue(value: string | null, formatter: Intl.DateTimeFormat) {
  if (!value) return "-";

  const parsed = parseDateValue(value);
  if (Number.isNaN(parsed.getTime())) return value;

  return formatter.format(parsed);
}

export function formatDateTimeValue(
  value: string | null,
  timeZone: string,
  options: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" }
) {
  if (!value) return "-";

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;

  return new Intl.DateTimeFormat("en-US", { ...options, timeZone }).format(parsed);
}
