const VIEWS = ['today', 'week', 'household', 'pantry'];
const THRESHOLD = 50; // min px to count as a swipe
const ANGLE_LIMIT = 0.6; // max vertical/horizontal ratio — keeps scroll from triggering

export function initSwipeNav(switchViewFn, getCurrentView) {
  let startX = 0;
  let startY = 0;
  let tracking = false;

  function onStart(x, y) {
    startX = x;
    startY = y;
    tracking = true;
  }

  function onEnd(x, y) {
    if (!tracking) return;
    tracking = false;

    const dx = x - startX;
    const dy = y - startY;

    // Ignore if mostly vertical (user is scrolling)
    if (Math.abs(dy) / (Math.abs(dx) || 1) > ANGLE_LIMIT) return;
    if (Math.abs(dx) < THRESHOLD) return;

    const current = getCurrentView();
    const idx = VIEWS.indexOf(current);
    if (idx === -1) return;

    if (dx < 0 && idx < VIEWS.length - 1) switchViewFn(VIEWS[idx + 1]); // swipe left → next
    if (dx > 0 && idx > 0)               switchViewFn(VIEWS[idx - 1]); // swipe right → prev
  }

  // Touch
  document.addEventListener('touchstart', e => {
    const t = e.touches[0];
    onStart(t.clientX, t.clientY);
  }, { passive: true });

  document.addEventListener('touchend', e => {
    const t = e.changedTouches[0];
    onEnd(t.clientX, t.clientY);
  }, { passive: true });

  // Mouse (desktop hold-and-drag)
  document.addEventListener('mousedown', e => onStart(e.clientX, e.clientY));
  document.addEventListener('mouseup',   e => onEnd(e.clientX, e.clientY));
}
