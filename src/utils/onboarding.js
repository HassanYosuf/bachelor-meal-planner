const STEPS = [
  {
    nav: 'pantry',
    color: '#d4700a',
    bg: 'rgba(212,112,10,0.12)',
    svg: `<svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
            <path d="M19 10v2a7 7 0 0 1-14 0v-2H3v2a9 9 0 0 0 8 8.94V23h2v-2.06A9 9 0 0 0 21 12v-2h-2z"/>
          </svg>`,
    title: 'Tell us what\'s in your kitchen',
    body: 'Tap the mic and speak what\'s in your fridge — ingredients are added automatically.',
  },
  {
    nav: 'pantry',
    color: '#2d9e6b',
    bg: 'rgba(45,158,107,0.12)',
    svg: `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <path d="M3 2h1l1.5 9h13L21 2h1"/><path d="M6.5 17a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z"/>
            <path d="M17.5 17a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z"/>
          </svg>`,
    title: 'See what you can cook right now',
    body: 'We match your pantry to meals instantly. Missing one ingredient? We\'ll add it to your shopping list.',
  },
  {
    nav: 'today',
    color: '#5b6af0',
    bg: 'rgba(91,106,240,0.12)',
    svg: `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/>
            <line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
            <line x1="8" y1="14" x2="8" y2="14"/><line x1="12" y1="14" x2="12" y2="14"/><line x1="16" y1="14" x2="16" y2="14"/>
          </svg>`,
    title: 'Log meals & build streaks',
    body: 'Track what you eat each day, hit your calorie goals, and keep your streak alive.',
  },
];

let currentStep = 0;
let _userId = '';

function onboardingKey(userId) { return `onboarding_done_${userId}`; }

export function checkOnboarding(userId) {
  if (localStorage.getItem(onboardingKey(userId))) return;
  _userId = userId;
  showStep(0);
}

function showStep(step) {
  currentStep = step;
  removeOnboarding();

  const s = STEPS[step];
  const isLast = step === STEPS.length - 1;

  const backdrop = document.createElement('div');
  backdrop.id = 'onboarding-backdrop';
  backdrop.className = 'onboarding-backdrop';
  document.body.appendChild(backdrop);

  const card = document.createElement('div');
  card.id = 'onboarding-card';
  card.className = 'onboarding-card';
  card.innerHTML = `
    <button class="onboarding-close" onclick="onboardingDone()">✕</button>
    <div class="onboarding-icon-wrap" style="background:${s.bg};color:${s.color}">
      ${s.svg}
    </div>
    <div class="onboarding-progress">
      ${STEPS.map((_, i) => `<div class="onboarding-dot${i === step ? ' active' : ''}"></div>`).join('')}
    </div>
    <h3 class="onboarding-title">${s.title}</h3>
    <p class="onboarding-body">${s.body}</p>
    <div class="onboarding-actions">
      <button class="onboarding-next-btn" style="background:${s.color}" onclick="${isLast ? 'onboardingDone()' : 'onboardingNext()'}">
        ${isLast ? 'Get started' : 'Next'}
        ${isLast ? '' : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12,5 19,12 12,19"/></svg>'}
      </button>
    </div>`;
  document.body.appendChild(card);

  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('onboarding-highlight'));
  const target = document.querySelector(`.nav-btn[data-view="${s.nav}"]`);
  if (target) target.classList.add('onboarding-highlight');
}

function removeOnboarding() {
  document.getElementById('onboarding-backdrop')?.remove();
  document.getElementById('onboarding-card')?.remove();
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('onboarding-highlight'));
}

export function onboardingNext() {
  if (currentStep < STEPS.length - 1) showStep(currentStep + 1);
}

export function onboardingDone() {
  localStorage.setItem(onboardingKey(_userId), '1');
  removeOnboarding();
}
