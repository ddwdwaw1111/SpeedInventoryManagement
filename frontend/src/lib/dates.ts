export function parseDateValue(value: string) {
  const trimmed = value.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T00:00:00(?:\.000)?Z)?$/.exec(trimmed);

  if (match) {
    const [, year, month, day] = match;
    return new Date(Number(year), Number(month) - 1, Number(day));
  }

  return new Date(trimmed);
}

export function parseDateLikeValue(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const parsed = /^\d{4}-\d{2}-\d{2}(?:T00:00:00(?:\.000)?Z)?$/.test(trimmed)
    ? parseDateValue(trimmed)
    : new Date(trimmed);

  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed;
}

export function isCalendarDateValue(value: string | null | undefined) {
  if (!value) {
    return false;
  }

  return /^\d{4}-\d{2}-\d{2}(?:T00:00:00(?:\.000)?Z)?$/.test(value.trim());
}

export function toIsoDateString(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function normalizeCalendarDate(value: string | null | undefined) {
  const parsed = parseDateLikeValue(value);
  return parsed ? toIsoDateString(parsed) : null;
}

export function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function startOfLocalWeek(date: Date) {
  const day = startOfLocalDay(date);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() - day.getDay());
}

export function shiftLocalDay(date: Date, delta: number) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + delta);
}

export function shiftIsoDate(value: string, delta: number) {
  const parsed = parseDateValue(value);
  parsed.setDate(parsed.getDate() + delta);
  return toIsoDateString(parsed);
}

export function getZonedDateRangeUtcBounds(startDate: string, endDate: string, timeZone: string) {
  return {
    startAt: startDate ? getZonedDayBoundaryIso(startDate, timeZone, 0) : undefined,
    endBefore: endDate ? getZonedDayBoundaryIso(endDate, timeZone, 1) : undefined
  };
}

export function getLocalDayBucketKey(date: Date) {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

export function getLocalMonthBucketKey(date: Date) {
  return `${date.getFullYear()}-${date.getMonth()}`;
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

  if (isCalendarDateValue(value)) {
    const dateOnlyOptions = stripTimeOptions(options);
    return formatDateValue(
      value,
      new Intl.DateTimeFormat("en-US", {
        ...(Object.keys(dateOnlyOptions).length > 0 ? dateOnlyOptions : { dateStyle: "medium" }),
        timeZone
      })
    );
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;

  return new Intl.DateTimeFormat("en-US", { ...options, timeZone }).format(parsed);
}

export function toIsoDateTimeString(value: string | null | undefined) {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    return undefined;
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }

  return parsed.toISOString();
}

export function toDateTimeLocalInputValue(value: string | null | undefined) {
  if (!value) {
    return "";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }

  const year = parsed.getFullYear();
  const month = `${parsed.getMonth() + 1}`.padStart(2, "0");
  const day = `${parsed.getDate()}`.padStart(2, "0");
  const hour = `${parsed.getHours()}`.padStart(2, "0");
  const minute = `${parsed.getMinutes()}`.padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

function stripTimeOptions(options: Intl.DateTimeFormatOptions) {
  const dateOnlyOptions: Intl.DateTimeFormatOptions = { ...options };
  delete dateOnlyOptions.timeStyle;
  delete dateOnlyOptions.hour;
  delete dateOnlyOptions.minute;
  delete dateOnlyOptions.second;
  delete dateOnlyOptions.dayPeriod;
  delete dateOnlyOptions.timeZoneName;
  delete dateOnlyOptions.hour12;
  delete dateOnlyOptions.hourCycle;
  return dateOnlyOptions;
}

function getZonedDayBoundaryIso(value: string, timeZone: string, dayOffset: number) {
  const parts = parseIsoDateParts(value);
  if (!parts) {
    return undefined;
  }

  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + dayOffset));
  const boundary = zonedDateTimeToUtc({
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: 0,
    minute: 0,
    second: 0
  }, timeZone);
  return boundary.toISOString();
}

function zonedDateTimeToUtc(
  parts: { year: number; month: number; day: number; hour: number; minute: number; second: number },
  timeZone: string
) {
  const utcGuess = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  const firstPass = utcGuess - getTimeZoneOffsetMs(new Date(utcGuess), timeZone);
  const secondPass = utcGuess - getTimeZoneOffsetMs(new Date(firstPass), timeZone);
  return new Date(secondPass);
}

function getTimeZoneOffsetMs(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  const zonedAsUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  return zonedAsUtc - date.getTime();
}

function parseIsoDateParts(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) {
    return null;
  }

  const [, yearValue, monthValue, dayValue] = match;
  const year = Number(yearValue);
  const month = Number(monthValue);
  const day = Number(dayValue);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    return null;
  }
  return { year, month, day };
}
