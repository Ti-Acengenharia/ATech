export const PROGRAMMING_TIME_ZONE = 'America/Maceio'

const programmingDateTimeFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: PROGRAMMING_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

function programmingDateTimeParts(value: Date) {
  const parts = programmingDateTimeFormatter.formatToParts(value)
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((item) => item.type === type)?.value)
  return {
    year: part('year'),
    month: part('month'),
    day: part('day'),
    hour: part('hour'),
    minute: part('minute'),
  }
}

export function programmingDateString(value: Date) {
  const { year, month, day } = programmingDateTimeParts(value)
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function programmingTimeString(value: Date) {
  const { hour, minute } = programmingDateTimeParts(value)
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

export function programmingMinutes(value: Date) {
  const { hour, minute } = programmingDateTimeParts(value)
  return hour * 60 + minute
}

export function programmingDateTimeString(value: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: PROGRAMMING_TIME_ZONE,
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value))
}

export function programmingDateTimeToIso(date: string, time: string) {
  const [year, month, day] = date.split('-').map(Number)
  const [hour, minute] = time.split(':').map(Number)
  const wallTimeAsUtc = Date.UTC(year, month - 1, day, hour, minute)
  let instant = wallTimeAsUtc

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { year: localYear, month: localMonth, day: localDay, hour: localHour, minute: localMinute } =
      programmingDateTimeParts(new Date(instant))
    const representedAsUtc = Date.UTC(localYear, localMonth - 1, localDay, localHour, localMinute)
    const nextInstant = wallTimeAsUtc - (representedAsUtc - instant)
    if (nextInstant === instant) break
    instant = nextInstant
  }

  return new Date(instant).toISOString()
}
