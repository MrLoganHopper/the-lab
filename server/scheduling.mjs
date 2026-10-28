import { DateTime, Interval } from 'luxon';

/** The next relevant Thursday in the cafe timezone. Thu after closing rolls to next week. */
export function cafeThursday(now = DateTime.now(), zone = 'America/Los_Angeles') {
  const local = now.setZone(zone);
  let daysAhead = (4 - local.weekday + 7) % 7;
  if (daysAhead === 0 && local.hour >= 20) daysAhead = 7;
  return local.plus({ days: daysAhead }).toISODate();
}

export function cafeHours(date, zone = 'America/Los_Angeles') {
  const start = DateTime.fromISO(date, { zone }).set({ hour: 10, minute: 0, second: 0, millisecond: 0 });
  const end = start.set({ hour: 20 });
  if (!start.isValid || !end.isValid) throw new Error('Invalid date');
  return { start, end };
}

export function makeSlots(date, zone = 'America/Los_Angeles', duration = 30) {
  if (!Number.isInteger(duration) || duration < 15 || 600 % duration !== 0) throw new Error('Invalid slot duration');
  const { start, end } = cafeHours(date, zone);
  const slots = [];
  for (let t = start; t < end; t = t.plus({ minutes: duration })) {
    slots.push({ start: t.toUTC().toISO(), end: t.plus({ minutes: duration }).toUTC().toISO() });
  }
  return slots;
}

export function overlaps(aStart, aEnd, bStart, bEnd) {
  return Date.parse(aStart) < Date.parse(bEnd) && Date.parse(aEnd) > Date.parse(bStart);
}

export function classifySlots(slots, busyEvents, countFn, capacity) {
  return slots.map(slot => {
    const busy = busyEvents.find(e => overlaps(slot.start, slot.end, e.start, e.end));
    const booked = countFn(slot.start, slot.end);
    const remaining = Math.max(0, capacity - booked);
    return {
      ...slot, remaining,
      available: !busy && remaining > 0,
      reason: busy ? 'calendar' : remaining <= 0 ? 'full' : null,
      label: busy ? (busy.title || 'Busy') : remaining <= 0 ? 'Cafe fully booked' : null
    };
  });
}

export function overlapsInterval(start, end, events) {
  return events.some(event => overlaps(start, end, event.start, event.end));
}
