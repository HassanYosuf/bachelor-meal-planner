export function getMonday(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function todayDayOfWeek() {
  const d = new Date().getDay();
  return d === 0 ? 6 : d - 1;
}

export function weekStartStr(date) {
  return date.toISOString().split('T')[0];
}

export function dayName(idx) {
  return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][idx];
}

export function dayDate(weekStart, idx) {
  const d = new Date(weekStart);
  d.setDate(d.getDate() + idx);
  return d;
}

export function isThisWeek(weekStart) {
  return weekStart.toDateString() === getMonday(new Date()).toDateString();
}
