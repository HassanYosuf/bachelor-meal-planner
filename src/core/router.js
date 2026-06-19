import { state } from './state.js';
import { initTheme } from '../utils/theme.js';
import { updateHeaderUser, showAuthState } from '../features/auth/auth.ui.js';
import { setDate, setupListeners, loadMeals, loadTodayLog, loadAndShowStreak } from '../features/meals/meals.ui.js';
import { loadHouseholdSilent, setupHouseholdRealtime } from '../features/household/household.ui.js';
import { loadWeekView } from '../features/week-plan/weekPlan.ui.js';
import { loadHouseholdView } from '../features/household/household.ui.js';
import { loadPantryView } from '../features/pantry/pantry.ui.js';
import { db } from './supabase.js';
import { checkOnboarding, onboardingNext, onboardingDone } from '../utils/onboarding.js';
export { onboardingNext, onboardingDone };


export function showAuthScreen() {
  document.getElementById('auth-screen').style.display = 'flex';
  document.getElementById('app').style.display = 'none';
}

export async function showApp() {
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  setDate();
  setupListeners();
  updateHeaderUser();
  await loadMeals();
  await loadTodayLog();
  loadAndShowStreak();
  await loadHouseholdSilent();
  setTimeout(() => checkOnboarding(state.currentUser.id), 800);
  setupHouseholdRealtime();
}

export function switchView(view) {
  state.currentView = view;
  document.getElementById('view-today').style.display     = view === 'today'     ? 'block' : 'none';
  document.getElementById('view-week').style.display      = view === 'week'      ? 'block' : 'none';
  document.getElementById('view-household').style.display = view === 'household' ? 'block' : 'none';
  document.getElementById('view-pantry').style.display    = view === 'pantry'    ? 'block' : 'none';
  document.getElementById('stats-row').style.display      = view === 'today'     ? 'flex'  : 'none';

  document.querySelectorAll('.nav-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.view === view));
  document.getElementById('user-menu').style.display = 'none';

  if (view === 'week')      loadWeekView();
  if (view === 'household') loadHouseholdView();
  if (view === 'pantry')    loadPantryView();
}

export async function initApp() {
  initTheme();
  const { data: { session } } = await db.auth.getSession();
  if (session) {
    state.currentUser = session.user;
    await showApp();
  } else {
    showAuthScreen();
  }

  db.auth.onAuthStateChange(async (event, session) => {
    if (event === 'PASSWORD_RECOVERY') {
      state.inPasswordRecovery = true;
      state.currentUser = session.user;
      showAuthScreen();
      showAuthState('new-password');
    } else if (event === 'SIGNED_IN' && !state.currentUser && !state.inPasswordRecovery) {
      state.currentUser = session.user;
      await showApp();
    } else if (event === 'USER_UPDATED' && state.currentUser) {
      state.currentUser = session.user;
      updateHeaderUser();
    } else if (event === 'SIGNED_OUT') {
      state.currentUser = null;
      state.inPasswordRecovery = false;
      showAuthScreen();
      showAuthState('form');
    }
  });
}
