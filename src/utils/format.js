export function fmtTime(secs) {
  if (secs >= 3600) {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    return h + 'h ' + (m > 0 ? m + 'm' : '');
  }
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

export function userInitial(user) {
  if (!user) return '?';
  const m = user.user_metadata || {};
  const name = m.name || m.full_name;
  if (name) return name[0].toUpperCase();
  return (user.email || '?')[0].toUpperCase();
}
