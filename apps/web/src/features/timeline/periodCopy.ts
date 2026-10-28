// Plain-language times for the answer and the chart.

/** "7 AM", or "6:47 AM" when the minutes aren't zero. */
export function formatClock(time: string, timeZone: string | null): string {
  const text = new Date(time).toLocaleTimeString('en-US', {
    timeZone: timeZone ?? undefined,
    hour: 'numeric',
    minute: '2-digit',
  });
  return text.replace(':00', '');
}

function localDate(time: string, timeZone: string | null): string {
  return new Date(time).toLocaleDateString('en-CA', { timeZone: timeZone ?? undefined });
}

/** "Today", "Tomorrow", or "Wed, Oct 28", by the location's local date. */
export function dayLabel(time: string, now: string, timeZone: string | null): string {
  const day = localDate(time, timeZone);
  if (day === localDate(now, timeZone)) return 'Today';
  if (day === localDate(new Date(Date.parse(now) + 86_400_000).toISOString(), timeZone))
    return 'Tomorrow';
  return new Date(time).toLocaleDateString('en-US', {
    timeZone: timeZone ?? undefined,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}
