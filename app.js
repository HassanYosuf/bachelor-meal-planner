/* ─── Supabase Config ─── */
const SUPABASE_URL = 'https://ecaakbixqzxaznrocyql.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVjYWFrYml4cXp4YXpucm9jeXFsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY0MzM2MjMsImV4cCI6MjA5MjAwOTYyM30.D1cC8xRU_shRcas-VHShWN1qNjEL5uFWY-IaG2BMmXM';

const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* ─── State ─── */
let currentUser = null;
let currentView = 'today';
let allMeals = [];
let loggedMeals = [];
let selectedType = 'breakfast';
let soakTimer = null;
let soakRemaining = 0;
let currentPrepMeal = null;
const today = new Date();
const todayStr = today.toISOString().split('T')[0];

let currentWeekStart = getMonday(new Date());
let selectedWeekDayIdx = todayDayOfWeek();
let weekPlanData = {};
let weekModalTarget = null;

let householdData = null;
let householdMembers = [];
let selfMember = null;
let weekPlanChannel = null;

/* ─── Collaborative State ─── */
let currentWeekSlots   = {};   // keyed `${dayIdx}-${mealType}` → week_slots row
let slotSuggestions    = {};   // keyed slot_id → meal_suggestions[]
let slotVotes          = {};   // keyed slot_id → meal_votes[]
let currentDM          = null; // decision_maker_user_id for current week
let suggestModalTarget = null; // { dayIdx, mealType, slotId }
let resolveModalTarget = null; // { slotId }
let collaborativeChannel = null;

/* ─── Date Helpers ─── */
function getMonday(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function todayDayOfWeek() {
  const d = new Date().getDay();
  return d === 0 ? 6 : d - 1;
}

function weekStartStr(date) {
  return date.toISOString().split('T')[0];
}

function dayName(idx) {
  return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][idx];
}

function dayDate(weekStart, idx) {
  const d = new Date(weekStart);
  d.setDate(d.getDate() + idx);
  return d;
}

function isThisWeek(weekStart) {
  return weekStart.toDateString() === getMonday(new Date()).toDateString();
}

function userInitial(user) {
  if (!user) return '?';
  const name = user.user_metadata && user.user_metadata.name;
  if (name) return name[0].toUpperCase();
  return (user.email || '?')[0].toUpperCase();
}

/* ─── Auth ─── */
let authMode = 'signin';
let inPasswordRecovery = false;

function showAuthState(state) {
  ['form', 'confirm', 'forgot', 'reset-sent', 'new-password'].forEach(s => {
    const el = document.getElementById('auth-state-' + s);
    if (el) el.style.display = 'none';
  });
  const target = document.getElementById('auth-state-' + state);
  if (target) target.style.display = (state === 'confirm' || state === 'reset-sent') ? 'flex' : 'block';
  // Show/hide "Forgot password?" only in sign-in mode
  const fl = document.getElementById('forgot-link');
  if (fl) fl.style.display = (state === 'form' && authMode === 'signin') ? 'block' : 'none';
}

function switchAuthTab(mode) {
  authMode = mode;
  document.getElementById('tab-signin').classList.toggle('active', mode === 'signin');
  document.getElementById('tab-signup').classList.toggle('active', mode === 'signup');
  document.getElementById('signup-name-row').style.display = mode === 'signup' ? 'block' : 'none';
  document.getElementById('auth-submit-btn').textContent = mode === 'signin' ? 'Sign in' : 'Create account';
  document.getElementById('auth-error').textContent = '';
  showAuthState('form');
}

async function submitAuth() {
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  const errEl = document.getElementById('auth-error');
  const btn = document.getElementById('auth-submit-btn');
  errEl.textContent = '';
  errEl.style.color = 'var(--red)';

  if (!email || !password) { errEl.textContent = 'Fill in all fields'; return; }

  btn.disabled = true;
  btn.textContent = '...';

  let result;
  if (authMode === 'signin') {
    result = await db.auth.signInWithPassword({ email, password });
  } else {
    const name = document.getElementById('auth-name').value.trim();
    result = await db.auth.signUp({
      email,
      password,
      options: { data: { name: name || email.split('@')[0] } },
    });
  }

  btn.disabled = false;
  btn.textContent = authMode === 'signin' ? 'Sign in' : 'Create account';

  if (result.error) {
    errEl.textContent = result.error.message;
  } else if (authMode === 'signup' && result.data.user && !result.data.session) {
    document.getElementById('auth-confirm-email').textContent = result.data.user.email;
    showAuthState('confirm');
  }
}

async function submitForgotPassword() {
  const email = document.getElementById('forgot-email').value.trim();
  const errEl = document.getElementById('forgot-error');
  errEl.textContent = '';
  if (!email) { errEl.textContent = 'Enter your email'; return; }

  const { error } = await db.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.href,
  });

  if (error) { errEl.textContent = error.message; return; }
  document.getElementById('reset-sent-email').textContent = email;
  showAuthState('reset-sent');
}

async function sendPasswordReset() {
  const { error } = await db.auth.resetPasswordForEmail(currentUser.email, {
    redirectTo: window.location.href,
  });
  showToast(error ? 'Could not send reset email' : 'Password reset link sent to your email');
}

async function submitNewPassword() {
  const pw = document.getElementById('new-password').value;
  const pw2 = document.getElementById('new-password-confirm').value;
  const errEl = document.getElementById('new-password-error');
  errEl.textContent = '';

  if (!pw || pw.length < 6) { errEl.textContent = 'Password must be at least 6 characters'; return; }
  if (pw !== pw2) { errEl.textContent = 'Passwords do not match'; return; }

  const { error } = await db.auth.updateUser({ password: pw });
  if (error) { errEl.textContent = error.message; return; }

  inPasswordRecovery = false;
  showToast('Password updated!');
  await showApp();
}

async function signOut() {
  await db.auth.signOut();
  document.getElementById('user-menu').style.display = 'none';
}

function toggleUserMenu() {
  const m = document.getElementById('user-menu');
  m.style.display = m.style.display === 'none' ? 'block' : 'none';
}

/* ─── Boot ─── */
async function init() {
  const { data: { session } } = await db.auth.getSession();
  if (session) {
    currentUser = session.user;
    await showApp();
  } else {
    showAuthScreen();
  }

  db.auth.onAuthStateChange(async (event, session) => {
    if (event === 'PASSWORD_RECOVERY') {
      inPasswordRecovery = true;
      currentUser = session.user;
      showAuthScreen();
      showAuthState('new-password');
    } else if (event === 'SIGNED_IN' && !currentUser && !inPasswordRecovery) {
      currentUser = session.user;
      await showApp();
    } else if (event === 'USER_UPDATED' && currentUser) {
      currentUser = session.user;
      updateHeaderUser();
    } else if (event === 'SIGNED_OUT') {
      currentUser = null;
      inPasswordRecovery = false;
      showAuthScreen();
      showAuthState('form');
    }
  });
}

function showAuthScreen() {
  document.getElementById('auth-screen').style.display = 'flex';
  document.getElementById('app').style.display = 'none';
}

function updateHeaderUser() {
  if (!currentUser) return;
  updateAvatarDisplay();
  const name = (currentUser.user_metadata && currentUser.user_metadata.name) || currentUser.email;
  document.getElementById('user-menu-name').textContent = name;
  document.getElementById('user-menu-email').textContent = currentUser.email;
}

async function showApp() {
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  setDate();
  setupListeners();

  updateHeaderUser();

  await loadMeals();
  await loadTodayLog();
  await loadHouseholdSilent();
  setupHouseholdRealtime();
}

/* ─── View Switching ─── */
function switchView(view) {
  currentView = view;
  document.getElementById('view-today').style.display = view === 'today' ? 'block' : 'none';
  document.getElementById('view-week').style.display = view === 'week' ? 'block' : 'none';
  document.getElementById('view-household').style.display = view === 'household' ? 'block' : 'none';
  document.getElementById('stats-row').style.display = view === 'today' ? 'flex' : 'none';

  document.querySelectorAll('.nav-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.view === view));
  document.getElementById('user-menu').style.display = 'none';

  if (view === 'week') loadWeekView();
  if (view === 'household') loadHouseholdView();
}

/* ─── Today ─── */
function setDate() {
  document.getElementById('hdr-date').textContent = today.toLocaleDateString('en-IN', {
    weekday: 'short', day: 'numeric', month: 'short',
  });
}

async function loadMeals() {
  const { data, error } = await db.from('meals').select('*').order('category').order('name');
  if (error) { showToast('Could not load meals'); return; }
  allMeals = data || [];
  populateDropdown('meal-drop', allMeals.filter(m => m.meal_type === selectedType));
}

function populateDropdown(id, meals) {
  const list = document.getElementById(id + '-list');
  const btn = document.getElementById(id + '-btn');
  btn.textContent = 'Choose a meal...';
  btn.dataset.value = '';

  const groups = {};
  meals.forEach(m => {
    if (!groups[m.category]) groups[m.category] = [];
    groups[m.category].push(m);
  });

  list.innerHTML = '';
  Object.keys(groups).sort().forEach(cat => {
    const grp = document.createElement('div');
    grp.className = 'dd-group';
    grp.textContent = cat;
    list.appendChild(grp);
    groups[cat].forEach(m => {
      const item = document.createElement('div');
      item.className = 'dd-item';
      item.dataset.value = m.id;
      item.textContent = m.name + (m.soak_mins ? ' ⏱' : '');
      item.addEventListener('click', () => {
        btn.textContent = item.textContent;
        btn.dataset.value = m.id;
        list.classList.remove('open');
        if (id === 'meal-drop') onMealSelect();
      });
      list.appendChild(item);
    });
  });
}

function toggleDropdown(id) {
  const list = document.getElementById(id + '-list');
  const isOpen = list.classList.contains('open');
  document.querySelectorAll('.custom-dropdown').forEach(d => d.classList.remove('open'));
  if (!isOpen) list.classList.add('open');
}

async function loadTodayLog() {
  const { data, error } = await db
    .from('meal_logs')
    .select('*')
    .eq('log_date', todayStr)
    .eq('user_id', currentUser.id)
    .order('logged_at');
  if (error) return;
  loggedMeals = data || [];
  renderLog();
  updateStats();
}

function onMealSelect() {
  const id = document.getElementById('meal-drop-btn').dataset.value;
  if (!id) {
    document.getElementById('meal-preview').style.display = 'none';
    document.getElementById('prep-alert').style.display = 'none';
    return;
  }
  const meal = allMeals.find(m => m.id === id);
  if (!meal) return;

  document.getElementById('preview-icon').textContent = meal.icon || '🍽';
  document.getElementById('preview-name').textContent = meal.name;
  document.getElementById('preview-meta').textContent = `~${meal.cal_estimate} kcal · ${meal.category}`;
  document.getElementById('meal-preview').style.display = 'flex';

  if (meal.soak_mins) {
    document.getElementById('prep-title').textContent = meal.name + ' — prep needed';
    document.getElementById('prep-msg').textContent = meal.soak_msg;
    soakRemaining = meal.soak_mins * 60;
    document.getElementById('prep-countdown').textContent = fmtTime(soakRemaining);
    document.getElementById('prep-start-btn').disabled = false;
    document.getElementById('prep-start-btn').textContent = 'Start timer';
    currentPrepMeal = meal;
    if (soakTimer) { clearInterval(soakTimer); soakTimer = null; }
    document.getElementById('prep-alert').style.display = 'block';
  } else {
    document.getElementById('prep-alert').style.display = 'none';
    currentPrepMeal = null;
    if (soakTimer) { clearInterval(soakTimer); soakTimer = null; }
  }
}

async function addMeal() {
  const id = document.getElementById('meal-drop-btn').dataset.value;
  if (!id) { showToast('Select a meal first'); return; }
  const meal = allMeals.find(m => m.id === id);
  if (!meal) return;

  const already = loggedMeals.find(l => l.meal_id === id && l.meal_type === selectedType);
  if (already) { showToast('Already added for ' + selectedType); return; }

  const entry = {
    log_date: todayStr,
    meal_id: meal.id,
    meal_name: meal.name,
    meal_type: selectedType,
    cal_estimate: meal.cal_estimate,
    user_id: currentUser.id,
  };

  const { data, error } = await db.from('meal_logs').insert(entry).select().single();
  if (error) { showToast('Could not save meal'); return; }

  loggedMeals.push(data);
  const dropBtn = document.getElementById('meal-drop-btn');
  dropBtn.textContent = 'Choose a meal...';
  dropBtn.dataset.value = '';
  document.getElementById('meal-preview').style.display = 'none';
  document.getElementById('prep-alert').style.display = 'none';
  renderLog();
  updateStats();
  await upsertSummary();
  showToast(meal.name + ' added');
}

async function removeMeal(logId) {
  const { error } = await db.from('meal_logs').delete().eq('id', logId);
  if (error) { showToast('Could not remove'); return; }
  loggedMeals = loggedMeals.filter(m => m.id !== logId);
  renderLog();
  updateStats();
  await upsertSummary();
}

async function clearAll() {
  if (!loggedMeals.length) return;
  const ids = loggedMeals.map(m => m.id);
  const { error } = await db.from('meal_logs').delete().in('id', ids);
  if (error) { showToast('Could not clear'); return; }
  loggedMeals = [];
  renderLog();
  updateStats();
  await upsertSummary();
  showToast('Log cleared');
}

async function saveLog() {
  if (!loggedMeals.length) { showToast('No meals to save'); return; }
  await upsertSummary();
  showToast("Today's log saved!");
}

async function upsertSummary() {
  const total_meals = loggedMeals.length;
  const total_cal = loggedMeals.reduce((s, m) => s + (m.cal_estimate || 0), 0);
  await db.from('daily_summaries').upsert({
    log_date: todayStr,
    total_meals,
    total_cal,
    updated_at: new Date().toISOString(),
    user_id: currentUser.id,
  }, { onConflict: 'log_date,user_id' });
}

function renderLog() {
  const logList = document.getElementById('log-list');
  const saveBtn = document.getElementById('save-btn');
  const clearBtn = document.getElementById('clear-btn');

  if (!loggedMeals.length) {
    logList.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🍽</div>
        <p>No meals logged yet</p>
        <span>Pick a meal above to get started</span>
      </div>`;
    saveBtn.style.display = 'none';
    clearBtn.style.display = 'none';
    return;
  }

  const pillClass = { breakfast: 'pill-breakfast', lunch: 'pill-lunch', dinner: 'pill-dinner', snack: 'pill-snack' };
  const mealData = id => allMeals.find(m => m.id === id) || {};

  logList.innerHTML = loggedMeals.map(l => {
    const m = mealData(l.meal_id);
    return `
      <div class="log-card${m.soak_mins ? ' has-prep' : ''}">
        <div class="log-emoji">${m.icon || '🍽'}</div>
        <div class="log-info">
          <div class="log-name">${l.meal_name}</div>
          <div class="log-meta">~${l.cal_estimate} kcal · ${m.category || ''}</div>
        </div>
        <div class="log-right">
          ${m.soak_mins ? '<span class="prep-tag">prep</span>' : ''}
          <span class="type-pill ${pillClass[l.meal_type] || 'pill-dinner'}">${l.meal_type[0].toUpperCase()}</span>
          <button class="del-btn" onclick="removeMeal('${l.id}')" title="Remove">×</button>
        </div>
      </div>`;
  }).join('');

  saveBtn.style.display = 'flex';
  clearBtn.style.display = 'block';
}

function updateStats() {
  const totalCal = loggedMeals.reduce((s, m) => s + (m.cal_estimate || 0), 0);
  const prepCount = loggedMeals.filter(l => {
    const m = allMeals.find(x => x.id === l.meal_id);
    return m && m.soak_mins;
  }).length;
  document.getElementById('s-meals').textContent = loggedMeals.length;
  document.getElementById('s-cal').textContent = totalCal;
  document.getElementById('s-prep').textContent = prepCount;
}

/* ─── Prep Timer ─── */
function startSoakTimer() {
  if (soakTimer) clearInterval(soakTimer);
  const btn = document.getElementById('prep-start-btn');
  btn.disabled = true;
  btn.textContent = 'Running…';

  soakTimer = setInterval(() => {
    soakRemaining--;
    document.getElementById('prep-countdown').textContent = fmtTime(soakRemaining);
    if (soakRemaining <= 0) {
      clearInterval(soakTimer);
      soakTimer = null;
      document.getElementById('prep-countdown').textContent = 'Done!';
      onPrepDone(currentPrepMeal);
    }
  }, 1000);
}

function onPrepDone(meal) {
  const msg = meal ? meal.name + ' is ready to cook!' : 'Prep time is done!';
  document.getElementById('notif-text').textContent = msg;
  const bar = document.getElementById('notif-bar');
  bar.style.display = 'flex';
  setTimeout(() => { bar.style.display = 'none'; }, 5000);
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification('Meal prep done! 🍳', { body: msg });
  }
}

/* ─── Week Plan ─── */
async function loadWeekView() {
  renderWeekHeader();
  renderWeekDayTabs();
  await fetchWeekPlan();
  if (householdData) {
    await Promise.all([fetchCollaborativeData(), ensureDecisionMaker()]);
  }
  renderWeekSlots();
}

function renderWeekHeader() {
  const end = dayDate(currentWeekStart, 6);
  const fmt = d => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  document.getElementById('week-label').textContent =
    fmt(currentWeekStart) + ' – ' + fmt(end);
}

function renderWeekDayTabs() {
  const todayIdx = isThisWeek(currentWeekStart) ? todayDayOfWeek() : -1;
  document.getElementById('week-day-tabs').innerHTML =
    ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((name, i) => {
      const dateNum = dayDate(currentWeekStart, i).getDate();
      const isToday = i === todayIdx;
      const isSelected = i === selectedWeekDayIdx;
      return `
        <button class="week-day-tab${isSelected ? ' active' : ''}${isToday ? ' today' : ''}" onclick="selectWeekDay(${i})">
          <span class="week-day-name">${name}</span>
          <span class="week-day-num">${dateNum}</span>
        </button>`;
    }).join('');
}

function selectWeekDay(idx) {
  selectedWeekDayIdx = idx;
  renderWeekDayTabs();
  renderWeekSlots();
}

async function fetchWeekPlan() {
  const wStart = weekStartStr(currentWeekStart);
  const userIds = [currentUser.id, ...householdMembers.map(m => m.user_id)];

  const { data } = await db
    .from('week_plans')
    .select('*')
    .eq('week_start', wStart)
    .in('user_id', userIds);

  weekPlanData = {};
  if (data) {
    data.forEach(entry => {
      if (!weekPlanData[entry.user_id]) weekPlanData[entry.user_id] = {};
      if (!weekPlanData[entry.user_id][entry.day_of_week]) weekPlanData[entry.user_id][entry.day_of_week] = {};
      weekPlanData[entry.user_id][entry.day_of_week][entry.meal_type] = entry;
    });
  }
}

function renderWeekSlots() {
  const dayIdx = selectedWeekDayIdx;
  const mealTypes = ['breakfast', 'lunch', 'dinner', 'snack'];
  const labels = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack' };
  const dateStr = dayDate(currentWeekStart, dayIdx).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

  // ── Solo path (no household) — unchanged behaviour ──────────────
  if (!householdData) {
    const myPlan = (weekPlanData[currentUser.id] || {})[dayIdx] || {};
    document.getElementById('week-slots').innerHTML = `
      <div class="week-slots-title">${dayName(dayIdx)}, ${dateStr}</div>
      ${mealTypes.map(type => {
        const entry = myPlan[type];
        if (entry) {
          return `
            <div class="week-slot filled">
              <div class="slot-type-badge slot-${type}">${labels[type][0]}</div>
              <div class="slot-icon">${entry.icon || '🍽'}</div>
              <div class="slot-info">
                <div class="slot-name">${entry.meal_name}</div>
                <div class="slot-cal">~${entry.cal_estimate} kcal</div>
              </div>
              <button class="del-btn" onclick="removeFromWeekPlan('${entry.id}', ${dayIdx}, '${type}')">×</button>
            </div>`;
        }
        return `
          <div class="week-slot empty" onclick="openWeekModal(${dayIdx}, '${type}')">
            <div class="slot-type-badge slot-${type}">${labels[type][0]}</div>
            <div class="slot-add-text">${labels[type]}</div>
            <div class="slot-add-icon">+</div>
          </div>`;
      }).join('')}`;

    document.getElementById('roommate-plans').innerHTML = householdMembers.map(member => {
      const memberPlan = (weekPlanData[member.user_id] || {})[dayIdx] || {};
      const filled = mealTypes.filter(t => memberPlan[t]);
      if (!filled.length) return '';
      return `
        <section class="section roommate-section">
          <div class="roommate-header">
            <div class="roommate-avatar">${(member.display_name || '?')[0].toUpperCase()}</div>
            <span class="roommate-name">${member.display_name || 'Roommate'}'s plan</span>
          </div>
          ${filled.map(type => {
            const e = memberPlan[type];
            return `
              <div class="week-slot filled roommate-slot">
                <div class="slot-type-badge slot-${type}">${labels[type][0]}</div>
                <div class="slot-icon">${e.icon || '🍽'}</div>
                <div class="slot-info">
                  <div class="slot-name">${e.meal_name}</div>
                  <div class="slot-cal">~${e.cal_estimate} kcal</div>
                </div>
              </div>`;
          }).join('')}
        </section>`;
    }).join('');
    return;
  }

  // ── Household collaborative path ──────────────────────────────────
  document.getElementById('roommate-plans').innerHTML = '';

  const iAmDM = currentDM === currentUser.id;
  const dmMember = allMembersAll().find(m => m.user_id === currentDM);
  const dmName = dmMember ? dmMember.display_name : 'someone';

  document.getElementById('week-slots').innerHTML = `
    <div class="week-slots-title">${dayName(dayIdx)}, ${dateStr}</div>
    <div class="collab-dm-banner">
      🎯 This week's decision maker: <strong>${dmName}</strong>${iAmDM ? ' (you)' : ''}
    </div>
    ${mealTypes.map(type => renderCollabSlot(dayIdx, type, labels)).join('')}`;
}

function renderCollabSlot(dayIdx, mealType, labels) {
  const key = `${dayIdx}-${mealType}`;
  const slot = currentWeekSlots[key];
  const label = labels[mealType];
  const iAmDM = currentDM === currentUser.id;

  // FINALIZED — show winning meal card
  if (slot && slot.status === 'FINALIZED') {
    const meal = allMeals.find(m => m.id === slot.selected_meal_id);
    const badge = slot.selection_type === 'AUTO_VOTE' ? '🗳 Vote' : '⚡ DM pick';
    return `
      <div class="week-slot filled collab-finalized">
        <div class="slot-type-badge slot-${mealType}">${label[0]}</div>
        <div class="slot-icon">${meal ? meal.icon || '🍽' : '🍽'}</div>
        <div class="slot-info">
          <div class="slot-name">${meal ? meal.name : 'Unknown'}</div>
          <div class="slot-cal">~${meal ? meal.cal_estimate : 0} kcal · <span class="collab-win-badge">${badge}</span></div>
        </div>
      </div>`;
  }

  // TIE_PENDING — show tied suggestions + resolve button for DM
  if (slot && slot.status === 'TIE_PENDING') {
    const suggestions = slotSuggestions[slot.id] || [];
    const votes = slotVotes[slot.id] || [];
    const tally = {};
    votes.forEach(v => { tally[v.suggestion_id] = (tally[v.suggestion_id] || 0) + 1; });
    const maxVotes = Math.max(...Object.values(tally), 0);
    const tiedSugs = suggestions.filter(s => (tally[s.id] || 0) === maxVotes);
    return `
      <div class="collab-slot tie">
        <div class="collab-slot-header">
          <div class="slot-type-badge slot-${mealType}">${label[0]}</div>
          <span class="collab-slot-label">${label}</span>
          <span class="collab-status-badge status-tie">Tied</span>
        </div>
        ${tiedSugs.map(s => {
          const meal = allMeals.find(m => m.id === s.meal_id);
          return `
            <div class="collab-suggestion tie">
              <div class="collab-suggestion-icon">${meal ? meal.icon || '🍽' : '🍽'}</div>
              <div class="collab-suggestion-info">
                <div class="collab-suggestion-name">${meal ? meal.name : 'Unknown'}</div>
                <div class="collab-suggestion-by">${tally[s.id] || 0} votes</div>
              </div>
            </div>`;
        }).join('')}
        ${iAmDM
          ? `<button class="collab-resolve-btn" onclick="openResolveModal('${slot.id}')">Break the tie</button>`
          : `<div class="collab-waiting-hint">Waiting for ${(allMembersAll().find(m => m.user_id === currentDM) || {}).display_name || 'DM'} to decide</div>`}
      </div>`;
  }

  // OPEN (or no slot yet) — show suggestions + voting + suggest button
  const slotId = slot ? slot.id : null;
  const suggestions = slotId ? (slotSuggestions[slotId] || []) : [];
  const votes = slotId ? (slotVotes[slotId] || []) : [];
  const myVote = votes.find(v => v.user_id === currentUser.id);
  const tally = {};
  votes.forEach(v => { tally[v.suggestion_id] = (tally[v.suggestion_id] || 0) + 1; });

  return `
    <div class="collab-slot open">
      <div class="collab-slot-header">
        <div class="slot-type-badge slot-${mealType}">${label[0]}</div>
        <span class="collab-slot-label">${label}</span>
        <span class="collab-status-badge status-open">Voting</span>
      </div>
      ${suggestions.length
        ? suggestions.map(s => {
            const meal = allMeals.find(m => m.id === s.meal_id);
            const vCount = tally[s.id] || 0;
            const isMyVote = myVote && myVote.suggestion_id === s.id;
            const suggester = allMembersAll().find(m => m.user_id === s.suggested_by);
            return `
              <div class="collab-suggestion${isMyVote ? ' voted' : ''}">
                <div class="collab-suggestion-icon">${meal ? meal.icon || '🍽' : '🍽'}</div>
                <div class="collab-suggestion-info">
                  <div class="collab-suggestion-name">${meal ? meal.name : 'Unknown'}</div>
                  <div class="collab-suggestion-by">by ${suggester ? suggester.display_name : '?'}</div>
                </div>
                <div class="collab-suggestion-right">
                  <span class="collab-vote-count">${vCount}</span>
                  ${slotId ? `<button class="collab-vote-btn${isMyVote ? ' active' : ''}" onclick="submitVote('${slotId}', '${s.id}')">
                    ${isMyVote ? '✓' : '👍'}
                  </button>` : ''}
                </div>
              </div>`;
          }).join('')
        : '<div class="collab-empty-hint">No suggestions yet — be the first!</div>'}
      <button class="collab-suggest-btn" onclick="openSuggestModal(${dayIdx}, '${mealType}')">+ Suggest a meal</button>
    </div>`;
}

function openWeekModal(dayIdx, mealType) {
  weekModalTarget = { dayIdx, mealType };
  const labels = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack' };
  document.getElementById('week-modal-title').textContent =
    `Add ${labels[mealType]} · ${dayName(dayIdx)}`;
  populateDropdown('week-meal-drop', allMeals.filter(m => m.meal_type === mealType));
  document.getElementById('week-modal-overlay').style.display = 'block';
  document.getElementById('week-modal').classList.add('open');
}

function closeWeekModal() {
  document.getElementById('week-modal-overlay').style.display = 'none';
  const modal = document.getElementById('week-modal');
  modal.classList.remove('open');
  document.querySelectorAll('.custom-dropdown').forEach(d => d.classList.remove('open'));
  const btn = document.getElementById('week-meal-drop-btn');
  btn.textContent = 'Choose a meal...';
  btn.dataset.value = '';
  weekModalTarget = null;
}

async function confirmAddToWeek() {
  if (!weekModalTarget) return;
  const mealId = document.getElementById('week-meal-drop-btn').dataset.value;
  if (!mealId) { showToast('Select a meal'); return; }

  const meal = allMeals.find(m => m.id === mealId);
  if (!meal) return;

  const { dayIdx, mealType } = weekModalTarget;

  const { data, error } = await db.from('week_plans').upsert({
    user_id: currentUser.id,
    week_start: weekStartStr(currentWeekStart),
    day_of_week: dayIdx,
    meal_type: mealType,
    meal_id: meal.id,
    meal_name: meal.name,
    cal_estimate: meal.cal_estimate,
    icon: meal.icon,
  }, { onConflict: 'user_id,week_start,day_of_week,meal_type' }).select().single();

  if (error) { showToast('Could not save'); return; }

  if (!weekPlanData[currentUser.id]) weekPlanData[currentUser.id] = {};
  if (!weekPlanData[currentUser.id][dayIdx]) weekPlanData[currentUser.id][dayIdx] = {};
  weekPlanData[currentUser.id][dayIdx][mealType] = data;

  closeWeekModal();
  renderWeekSlots();
  showToast(meal.name + ' added to plan');
}

async function removeFromWeekPlan(id, dayIdx, mealType) {
  const { error } = await db.from('week_plans').delete().eq('id', id);
  if (error) { showToast('Could not remove'); return; }

  if (weekPlanData[currentUser.id] && weekPlanData[currentUser.id][dayIdx]) {
    delete weekPlanData[currentUser.id][dayIdx][mealType];
  }
  renderWeekSlots();
}

async function shiftWeek(dir) {
  const d = new Date(currentWeekStart);
  d.setDate(d.getDate() + dir * 7);
  currentWeekStart = d;
  selectedWeekDayIdx = isThisWeek(currentWeekStart) ? todayDayOfWeek() : 0;
  await loadWeekView();
}

/* ─── Household ─── */
async function loadHouseholdSilent() {
  const { data: memberships, error } = await db
    .from('household_members')
    .select('household_id, display_name')
    .eq('user_id', currentUser.id)
    .limit(1);

  if (error || !memberships || !memberships.length) return;

  const hId = memberships[0].household_id;
  householdData = householdData || { id: hId };

  const { data: members } = await db
    .from('household_members')
    .select('user_id, display_name, rotation_order, joined_at')
    .eq('household_id', hId);

  const allM = members || [];
  selfMember = allM.find(m => m.user_id === currentUser.id) || null;
  householdMembers = allM.filter(m => m.user_id !== currentUser.id);
}

function setupHouseholdRealtime() {
  if (weekPlanChannel) { db.removeChannel(weekPlanChannel); weekPlanChannel = null; }
  if (collaborativeChannel) { db.removeChannel(collaborativeChannel); collaborativeChannel = null; }

  if (!householdMembers.length && !householdData) return;

  // Solo-compatible: week_plans changes from other members
  weekPlanChannel = db
    .channel('household-week-plans')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'week_plans' }, (payload) => {
      const changedUserId = payload.new?.user_id || payload.old?.user_id;
      if (changedUserId && changedUserId !== currentUser.id) {
        if (currentView === 'week') fetchWeekPlan().then(renderWeekSlots);
      }
    })
    .subscribe();

  if (!householdData) return;

  // Collaborative: subscribe to week_slots, meal_suggestions, meal_votes
  collaborativeChannel = db
    .channel('collab-' + householdData.id)
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'week_slots', filter: `household_id=eq.${householdData.id}` },
      (payload) => {
        const s = payload.new || payload.old;
        if (!s) return;
        const key = `${s.day_of_week}-${s.meal_type}`;
        if (payload.eventType === 'DELETE') delete currentWeekSlots[key];
        else currentWeekSlots[key] = s;
        if (currentView === 'week') renderWeekSlots();
      })
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'meal_suggestions' },
      (payload) => {
        const s = payload.new;
        if (!s || s.suggested_by === currentUser.id) return;
        const isOurSlot = Object.values(currentWeekSlots).some(sl => sl.id === s.slot_id);
        if (!isOurSlot) return;
        if (!slotSuggestions[s.slot_id]) slotSuggestions[s.slot_id] = [];
        if (!slotSuggestions[s.slot_id].find(x => x.id === s.id)) {
          slotSuggestions[s.slot_id].push(s);
        }
        if (currentView === 'week') renderWeekSlots();
      })
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'meal_votes' },
      async (payload) => {
        const v = payload.new || payload.old;
        if (!v || v.user_id === currentUser.id) return;
        const isOurSlot = Object.values(currentWeekSlots).some(sl => sl.id === v.slot_id);
        if (!isOurSlot) return;
        if (!slotVotes[v.slot_id]) slotVotes[v.slot_id] = [];
        if (payload.eventType === 'DELETE') {
          slotVotes[v.slot_id] = slotVotes[v.slot_id].filter(x => x.id !== v.id);
        } else {
          slotVotes[v.slot_id] = slotVotes[v.slot_id].filter(x => x.user_id !== v.user_id);
          slotVotes[v.slot_id].push(v);
        }
        if (currentView === 'week') {
          await calculateWinningMeal(v.slot_id);
          renderWeekSlots();
        }
      })
    .subscribe();
}

async function loadHouseholdView() {
  const el = document.getElementById('household-content');
  el.innerHTML = `<div style="padding:24px"><div class="loading-spinner"><div class="spinner"></div><span>Loading...</span></div></div>`;

  const { data: memberships, error: memErr } = await db
    .from('household_members')
    .select('household_id')
    .eq('user_id', currentUser.id)
    .limit(1);

  if (memErr || !memberships || !memberships.length) {
    renderNoHousehold();
    return;
  }

  const hId = memberships[0].household_id;
  const wStart = weekStartStr(getMonday(new Date()));
  const [hhRes, memRes, rotRes] = await Promise.all([
    db.from('households').select('*').eq('id', hId).single(),
    db.from('household_members').select('user_id, display_name, rotation_order, joined_at').eq('household_id', hId),
    db.from('household_week_rotation').select('decision_maker_user_id').eq('household_id', hId).eq('week_start', wStart).maybeSingle(),
  ]);

  if (hhRes.error || !hhRes.data) { renderNoHousehold(); return; }

  householdData = hhRes.data;
  const allM = memRes.data || [];
  selfMember = allM.find(m => m.user_id === currentUser.id) || null;
  householdMembers = allM.filter(m => m.user_id !== currentUser.id);
  currentDM = rotRes.data ? rotRes.data.decision_maker_user_id : getCurrentDecisionMaker();

  renderHousehold(hhRes.data, allM, currentDM);
}

function renderNoHousehold() {
  document.getElementById('household-content').innerHTML = `
    <section class="section">
      <div class="section-label">Create a household</div>
      <p class="household-hint">Create a household and share the invite code with your roommates so they can join.</p>
      <input class="auth-input" id="hh-name" type="text" placeholder="Household name (e.g. Room 204)" />
      <button class="save-log-btn" style="margin-top:4px" onclick="createHousehold()">Create household</button>
    </section>
    <section class="section">
      <div class="section-label">Join a household</div>
      <p class="household-hint">Got an invite code from your roommate? Enter it below.</p>
      <input class="auth-input" id="hh-code" type="text" placeholder="Enter invite code" maxlength="8" style="text-transform:lowercase" />
      <button class="save-log-btn" style="margin-top:4px" onclick="joinHousehold()">Join household</button>
    </section>`;
}

function renderHousehold(h, members, dmUserId) {
  const sorted = [...members].sort((a, b) => (a.rotation_order || 99) - (b.rotation_order || 99));
  const nextDM = (() => {
    if (!sorted.length) return null;
    const idx = sorted.findIndex(m => m.user_id === dmUserId);
    return sorted[(idx + 1) % sorted.length];
  })();
  const dmMember = sorted.find(m => m.user_id === dmUserId);

  document.getElementById('household-content').innerHTML = `
    <section class="section">
      <div class="section-label">Your household</div>
      <div class="hh-name">${h.name}</div>
      <div class="hh-code-block">
        <div>
          <div class="hh-code-label">Invite code</div>
          <div class="hh-code">${h.invite_code}</div>
        </div>
        <button class="copy-btn" onclick="copyCode('${h.invite_code}')">Copy</button>
      </div>
      <p class="household-hint">Share this code with roommates so they can join and collaborate on the week plan.</p>
    </section>
    <section class="section">
      <div class="section-label">This week's decision maker</div>
      <div class="dm-card">
        <div class="dm-avatar">${(dmMember ? dmMember.display_name || '?' : '?')[0].toUpperCase()}</div>
        <div class="dm-info">
          <div class="dm-name">${dmMember ? dmMember.display_name || 'Unknown' : 'Unknown'}${dmUserId === currentUser.id ? ' (you)' : ''}</div>
          <div class="dm-sub">Resolves ties this week</div>
        </div>
      </div>
      ${nextDM ? `<div class="dm-next">Next week → <strong>${nextDM.display_name || 'Unknown'}</strong></div>` : ''}
    </section>
    <section class="section">
      <div class="section-label">Members (${members.length})</div>
      ${sorted.map(m => `
        <div class="member-row">
          <div class="roommate-avatar">${(m.display_name || '?')[0].toUpperCase()}</div>
          <div class="member-info">
            <div class="member-name">${m.display_name || 'Member'}${m.user_id === currentUser.id ? ' (you)' : ''}${m.user_id === dmUserId ? '<span class="member-dm-badge">DM</span>' : ''}</div>
            <div class="member-since">Joined ${new Date(m.joined_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</div>
          </div>
        </div>`).join('')}
    </section>
    <section class="section">
      <button class="clear-btn" onclick="leaveHousehold()">Leave household</button>
    </section>`;
}

async function createHousehold() {
  const name = document.getElementById('hh-name').value.trim();
  if (!name) { showToast('Enter a name'); return; }

  const { data: h, error: e1 } = await db.from('households').insert({
    name, created_by: currentUser.id,
  }).select().single();
  if (e1) { showToast('Could not create'); return; }

  const myName = (currentUser.user_metadata && currentUser.user_metadata.name) || currentUser.email;
  const { error: e2 } = await db.from('household_members').insert({
    household_id: h.id,
    user_id: currentUser.id,
    display_name: myName,
    rotation_order: 1,
  });
  if (e2) { showToast('Error joining household'); return; }

  householdData = h;
  householdMembers = [];
  showToast('Household created!');
  loadHouseholdView();
}

async function joinHousehold() {
  const code = document.getElementById('hh-code').value.trim().toLowerCase();
  if (!code) { showToast('Enter a code'); return; }

  const { data: h, error } = await db
    .from('households')
    .select('*')
    .eq('invite_code', code)
    .single();
  if (error || !h) { showToast('Invalid invite code'); return; }

  const myName = (currentUser.user_metadata && currentUser.user_metadata.name) || currentUser.email;
  const { data: existingM } = await db
    .from('household_members').select('rotation_order').eq('household_id', h.id)
    .order('rotation_order', { ascending: false }).limit(1);
  const maxOrder = (existingM && existingM[0] && existingM[0].rotation_order) || 0;

  const { error: e2 } = await db.from('household_members').insert({
    household_id: h.id,
    user_id: currentUser.id,
    display_name: myName,
    rotation_order: maxOrder + 1,
  });
  if (e2) { showToast('Already a member or error occurred'); return; }

  householdData = h;
  showToast('Joined ' + h.name + '!');
  await loadHouseholdSilent();
  setupHouseholdRealtime();
  loadHouseholdView();
}

async function leaveHousehold() {
  if (!householdData) return;
  const { error } = await db.from('household_members')
    .delete()
    .eq('household_id', householdData.id)
    .eq('user_id', currentUser.id);
  if (error) { showToast('Could not leave'); return; }
  householdData = null;
  householdMembers = [];
  selfMember = null;
  currentDM = null;
  currentWeekSlots = {};
  slotSuggestions = {};
  slotVotes = {};
  if (weekPlanChannel) { db.removeChannel(weekPlanChannel); weekPlanChannel = null; }
  if (collaborativeChannel) { db.removeChannel(collaborativeChannel); collaborativeChannel = null; }
  showToast('Left household');
  loadHouseholdView();
}

function copyCode(code) {
  navigator.clipboard.writeText(code).then(() => showToast('Code copied!'));
}

/* ─── Profile & Account ─── */

function updateAvatarDisplay() {
  const avatarUrl = currentUser.user_metadata && currentUser.user_metadata.avatar_url;
  const initial = userInitial(currentUser);
  const headerBtn = document.getElementById('avatar-btn');
  const menuAvatar = document.getElementById('user-menu-avatar');

  if (avatarUrl) {
    headerBtn.innerHTML = `<img src="${avatarUrl}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
    if (menuAvatar) menuAvatar.innerHTML = `<img src="${avatarUrl}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
  } else {
    headerBtn.textContent = initial;
    if (menuAvatar) menuAvatar.textContent = initial;
  }
}

function openProfileDrawer() {
  const name = (currentUser.user_metadata && currentUser.user_metadata.name) || '';
  const avatarUrl = currentUser.user_metadata && currentUser.user_metadata.avatar_url;

  document.getElementById('profile-name').value = name;
  document.getElementById('profile-email-ro').value = currentUser.email;

  const pa = document.getElementById('profile-avatar');
  if (avatarUrl) {
    pa.innerHTML = `<img src="${avatarUrl}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
  } else {
    pa.textContent = userInitial(currentUser);
    pa.style.fontSize = '28px';
  }

  document.getElementById('profile-overlay').classList.add('open');
  document.getElementById('profile-drawer').classList.add('open');
}

function closeProfileDrawer() {
  document.getElementById('profile-overlay').classList.remove('open');
  document.getElementById('profile-drawer').classList.remove('open');
}

function triggerAvatarUpload() {
  document.getElementById('avatar-file-input').click();
}

async function handleAvatarChange(input) {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) { showToast('Image must be under 5 MB'); return; }

  const ext = file.name.split('.').pop().toLowerCase();
  const path = `${currentUser.id}/avatar.${ext}`;

  showToast('Uploading...');
  const { error: upErr } = await db.storage.from('avatars').upload(path, file, { upsert: true });
  if (upErr) { showToast('Upload failed'); return; }

  const { data: urlData } = db.storage.from('avatars').getPublicUrl(path);
  const avatarUrl = urlData.publicUrl + '?t=' + Date.now();

  const { error: updErr } = await db.auth.updateUser({ data: { avatar_url: avatarUrl } });
  if (updErr) { showToast('Could not save avatar'); return; }

  currentUser.user_metadata = { ...currentUser.user_metadata, avatar_url: avatarUrl };
  updateAvatarDisplay();

  const pa = document.getElementById('profile-avatar');
  pa.innerHTML = `<img src="${avatarUrl}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
  input.value = '';
  showToast('Photo updated!');
}

async function saveProfile() {
  const name = document.getElementById('profile-name').value.trim();
  if (!name) { showToast('Enter a name'); return; }

  const { error } = await db.auth.updateUser({ data: { name } });
  if (error) { showToast('Could not save'); return; }

  currentUser.user_metadata = { ...currentUser.user_metadata, name };
  updateHeaderUser();
  closeProfileDrawer();
  showToast('Profile updated!');
}

/* ─── Delete Account ─── */

function openDeleteModal() {
  document.getElementById('delete-modal-overlay').style.display = 'block';
  document.getElementById('delete-modal').classList.add('open');
}

function closeDeleteModal() {
  document.getElementById('delete-modal-overlay').style.display = 'none';
  document.getElementById('delete-modal').classList.remove('open');
}

async function deleteAccount() {
  closeDeleteModal();
  showToast('Deleting account...');

  // Leave household first (best-effort)
  if (householdData) {
    await db.from('household_members')
      .delete().eq('household_id', householdData.id).eq('user_id', currentUser.id);
  }

  const { error } = await db.rpc('delete_user');
  if (error) { showToast('Could not delete account — contact support'); return; }

  currentUser = null;
  showAuthScreen();
  showAuthState('form');
  showToast('Account deleted');
}

/* ─── Collaborative Planning ─── */

function allMembersAll() {
  const myName = (currentUser.user_metadata && currentUser.user_metadata.name) || currentUser.email;
  const me = selfMember
    ? { ...selfMember, display_name: selfMember.display_name || myName }
    : { user_id: currentUser.id, display_name: myName, rotation_order: 1 };
  return [me, ...householdMembers].sort((a, b) => (a.rotation_order || 99) - (b.rotation_order || 99));
}

function getCurrentDecisionMaker() {
  const members = allMembersAll().filter(m => m.rotation_order != null);
  if (!members.length) return currentUser.id;
  const EPOCH_MONDAY = new Date('1970-01-05T00:00:00Z').getTime();
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const weekNumber = Math.floor((currentWeekStart.getTime() - EPOCH_MONDAY) / weekMs);
  const idx = ((weekNumber % members.length) + members.length) % members.length;
  return members[idx].user_id;
}

async function ensureDecisionMaker() {
  if (!householdData) return;
  const wStart = weekStartStr(currentWeekStart);
  const { data: existing } = await db
    .from('household_week_rotation')
    .select('decision_maker_user_id')
    .eq('household_id', householdData.id)
    .eq('week_start', wStart)
    .maybeSingle();

  if (existing) { currentDM = existing.decision_maker_user_id; return; }

  const dmId = getCurrentDecisionMaker();
  const { data, error } = await db.from('household_week_rotation').insert({
    household_id: householdData.id,
    week_start: wStart,
    decision_maker_user_id: dmId,
  }).select().single();

  if (!error && data) currentDM = data.decision_maker_user_id;
  else currentDM = dmId;
}

async function fetchCollaborativeData() {
  if (!householdData) return;
  const wStart = weekStartStr(currentWeekStart);

  const { data: slots } = await db
    .from('week_slots')
    .select('*')
    .eq('household_id', householdData.id)
    .eq('week_start', wStart);

  currentWeekSlots = {};
  const slotIds = [];
  (slots || []).forEach(s => {
    currentWeekSlots[`${s.day_of_week}-${s.meal_type}`] = s;
    slotIds.push(s.id);
  });

  if (!slotIds.length) { slotSuggestions = {}; slotVotes = {}; return; }

  const [sugRes, voteRes] = await Promise.all([
    db.from('meal_suggestions').select('*').in('slot_id', slotIds),
    db.from('meal_votes').select('*').in('slot_id', slotIds),
  ]);

  slotSuggestions = {};
  (sugRes.data || []).forEach(s => {
    if (!slotSuggestions[s.slot_id]) slotSuggestions[s.slot_id] = [];
    slotSuggestions[s.slot_id].push(s);
  });

  slotVotes = {};
  (voteRes.data || []).forEach(v => {
    if (!slotVotes[v.slot_id]) slotVotes[v.slot_id] = [];
    slotVotes[v.slot_id].push(v);
  });
}

async function getOrCreateSlot(dayIdx, mealType) {
  const key = `${dayIdx}-${mealType}`;
  if (currentWeekSlots[key]) return currentWeekSlots[key];
  const wStart = weekStartStr(currentWeekStart);

  const { data: existing } = await db
    .from('week_slots').select('*')
    .eq('household_id', householdData.id)
    .eq('week_start', wStart)
    .eq('day_of_week', dayIdx)
    .eq('meal_type', mealType)
    .maybeSingle();

  if (existing) { currentWeekSlots[key] = existing; return existing; }

  const { data, error } = await db.from('week_slots').insert({
    household_id: householdData.id,
    week_start: wStart,
    day_of_week: dayIdx,
    meal_type: mealType,
  }).select().single();

  if (error) { showToast('Could not open slot'); return null; }
  currentWeekSlots[key] = data;
  return data;
}

async function submitSuggestion(slotId, mealId) {
  const meal = allMeals.find(m => m.id === mealId);
  if (!meal) return;

  const { data, error } = await db.from('meal_suggestions').insert({
    slot_id: slotId,
    meal_id: mealId,
    suggested_by: currentUser.id,
  }).select().single();

  if (error) {
    showToast(error.code === '23505' ? 'Already suggested' : 'Could not suggest');
    return;
  }

  if (!slotSuggestions[slotId]) slotSuggestions[slotId] = [];
  slotSuggestions[slotId].push(data);
  closeSuggestModal();
  renderWeekSlots();
  showToast(meal.name + ' suggested!');
}

async function submitVote(slotId, suggestionId) {
  const slot = Object.values(currentWeekSlots).find(s => s.id === slotId);
  if (slot && slot.status === 'FINALIZED') { showToast('Voting is closed'); return; }

  // Delete existing vote for this slot (allows vote change)
  await db.from('meal_votes').delete().eq('slot_id', slotId).eq('user_id', currentUser.id);

  const { data, error } = await db.from('meal_votes').insert({
    slot_id: slotId,
    suggestion_id: suggestionId,
    user_id: currentUser.id,
  }).select().single();

  if (error) { showToast('Could not vote'); return; }

  if (!slotVotes[slotId]) slotVotes[slotId] = [];
  slotVotes[slotId] = slotVotes[slotId].filter(v => v.user_id !== currentUser.id);
  slotVotes[slotId].push(data);

  await calculateWinningMeal(slotId);
  renderWeekSlots();
}

async function calculateWinningMeal(slotId) {
  const slot = Object.values(currentWeekSlots).find(s => s.id === slotId);
  if (!slot || slot.status === 'FINALIZED') return;

  const votes = slotVotes[slotId] || [];
  const suggestions = slotSuggestions[slotId] || [];
  if (!votes.length || !suggestions.length) return;

  const tally = {};
  votes.forEach(v => { tally[v.suggestion_id] = (tally[v.suggestion_id] || 0) + 1; });
  const maxVotes = Math.max(...Object.values(tally));
  const winners = suggestions.filter(s => (tally[s.id] || 0) === maxVotes);

  const totalMembers = householdMembers.length + 1;
  const threshold = Math.ceil(totalMembers / 2);
  if (votes.length < threshold) return;

  let newStatus, selectedMealId, selectionType;
  if (winners.length === 1) {
    newStatus = 'FINALIZED';
    selectedMealId = winners[0].meal_id;
    selectionType = 'AUTO_VOTE';
  } else if (votes.length >= totalMembers) {
    newStatus = 'TIE_PENDING';
    selectedMealId = null;
    selectionType = null;
  } else {
    return;
  }

  const { data, error } = await db.from('week_slots')
    .update({ status: newStatus, selected_meal_id: selectedMealId, selection_type: selectionType })
    .eq('id', slotId).eq('status', 'OPEN').select().single();

  if (error || !data) return;

  const key = Object.keys(currentWeekSlots).find(k => currentWeekSlots[k].id === slotId);
  if (key) currentWeekSlots[key] = data;

  if (newStatus === 'FINALIZED') {
    const meal = allMeals.find(m => m.id === selectedMealId);
    showToast((meal ? meal.name : 'Meal') + ' won the vote! 🎉');
  } else {
    const dm = allMembersAll().find(m => m.user_id === currentDM);
    showToast('Tie! ' + (dm ? dm.display_name : 'DM') + ' must decide');
  }
}

async function resolveTie(slotId, mealId) {
  if (currentDM !== currentUser.id) { showToast('Only the decision maker can resolve ties'); return; }

  const { data, error } = await db.from('week_slots')
    .update({ status: 'FINALIZED', selected_meal_id: mealId, selection_type: 'TIE_BREAKER', selected_by: currentUser.id })
    .eq('id', slotId).select().single();

  if (error) { showToast('Could not resolve tie'); return; }

  const key = Object.keys(currentWeekSlots).find(k => currentWeekSlots[k].id === slotId);
  if (key) currentWeekSlots[key] = data;

  closeResolveModal();
  renderWeekSlots();
  const meal = allMeals.find(m => m.id === mealId);
  showToast((meal ? meal.name : 'Meal') + ' selected!');
}

/* ── Suggest Modal ── */
async function openSuggestModal(dayIdx, mealType) {
  if (!householdData) return;
  const slot = await getOrCreateSlot(dayIdx, mealType);
  if (!slot) return;
  suggestModalTarget = { dayIdx, mealType, slotId: slot.id };
  const labels = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack' };
  document.getElementById('suggest-modal-title').textContent =
    `Suggest ${labels[mealType]} · ${dayName(dayIdx)}`;
  populateDropdown('suggest-meal-drop', allMeals.filter(m => m.meal_type === mealType));
  document.getElementById('suggest-modal-overlay').style.display = 'block';
  document.getElementById('suggest-modal').classList.add('open');
}

function closeSuggestModal() {
  document.getElementById('suggest-modal-overlay').style.display = 'none';
  document.getElementById('suggest-modal').classList.remove('open');
  document.querySelectorAll('.custom-dropdown').forEach(d => d.classList.remove('open'));
  const btn = document.getElementById('suggest-meal-drop-btn');
  btn.textContent = 'Choose a meal...';
  btn.dataset.value = '';
  suggestModalTarget = null;
}

async function confirmSuggestMeal() {
  if (!suggestModalTarget) return;
  const mealId = document.getElementById('suggest-meal-drop-btn').dataset.value;
  if (!mealId) { showToast('Select a meal'); return; }
  await submitSuggestion(suggestModalTarget.slotId, mealId);
}

/* ── Resolve Tie Modal ── */
function openResolveModal(slotId) {
  resolveModalTarget = { slotId };
  renderResolveTieOptions(slotId);
  document.getElementById('resolve-modal-overlay').style.display = 'block';
  document.getElementById('resolve-modal').classList.add('open');
}

function closeResolveModal() {
  document.getElementById('resolve-modal-overlay').style.display = 'none';
  document.getElementById('resolve-modal').classList.remove('open');
  resolveModalTarget = null;
}

function renderResolveTieOptions(slotId) {
  const suggestions = slotSuggestions[slotId] || [];
  const votes = slotVotes[slotId] || [];
  const tally = {};
  votes.forEach(v => { tally[v.suggestion_id] = (tally[v.suggestion_id] || 0) + 1; });
  const maxVotes = Math.max(...Object.values(tally), 0);
  const tied = suggestions.filter(s => (tally[s.id] || 0) === maxVotes);

  document.getElementById('resolve-options-list').innerHTML = tied.map(s => {
    const meal = allMeals.find(m => m.id === s.meal_id);
    const vCount = tally[s.id] || 0;
    return `
      <div class="resolve-option" onclick="resolveTie('${slotId}', '${s.meal_id}')">
        <div class="resolve-option-icon">${meal ? meal.icon || '🍽' : '🍽'}</div>
        <div class="resolve-option-info">
          <div class="resolve-option-name">${meal ? meal.name : 'Unknown'}</div>
          <div class="resolve-option-votes">${vCount} vote${vCount !== 1 ? 's' : ''}</div>
        </div>
        <div class="resolve-option-arrow">›</div>
      </div>`;
  }).join('');
}

/* ─── History Drawer ─── */
async function openHistory() {
  document.getElementById('drawer-overlay').classList.add('open');
  document.getElementById('history-drawer').classList.add('open');

  const histList = document.getElementById('history-list');
  histList.innerHTML = `<div class="loading-spinner"><div class="spinner"></div><span>Loading history...</span></div>`;

  const { data, error } = await db
    .from('daily_summaries')
    .select('*')
    .eq('user_id', currentUser.id)
    .order('log_date', { ascending: false })
    .limit(30);

  if (error || !data || !data.length) {
    histList.innerHTML = '<p style="color:var(--text-3);font-size:13px;padding:8px 0">No history yet.</p>';
    return;
  }

  const logs = await Promise.all(data.map(async day => {
    const { data: meals } = await db
      .from('meal_logs')
      .select('meal_name')
      .eq('log_date', day.log_date)
      .eq('user_id', currentUser.id);
    return { ...day, meals: meals || [] };
  }));

  histList.innerHTML = logs.map(day => {
    const d = new Date(day.log_date + 'T00:00:00');
    const label = d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    return `
      <div class="history-day">
        <div class="history-day-header">
          <span class="history-date">${label}</span>
          <span class="history-stats">${day.total_meals} meals · ${day.total_cal} kcal</span>
        </div>
        <div class="history-meals">
          ${day.meals.map(m => `<span class="history-meal-pill">${m.meal_name}</span>`).join('')}
        </div>
      </div>`;
  }).join('');
}

function closeHistory() {
  document.getElementById('drawer-overlay').classList.remove('open');
  document.getElementById('history-drawer').classList.remove('open');
}

/* ─── Helpers ─── */
function fmtTime(secs) {
  if (secs >= 3600) {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    return h + 'h ' + (m > 0 ? m + 'm' : '');
  }
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

let toastTimer = null;
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2500);
}

/* ─── Event Listeners ─── */
function setupListeners() {
  document.querySelectorAll('.type-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.type-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedType = btn.dataset.type;
      const filtered = allMeals.filter(m => m.meal_type === selectedType);
      populateDropdown('meal-drop', filtered);
      document.getElementById('meal-preview').style.display = 'none';
      document.getElementById('prep-alert').style.display = 'none';
    });
  });

  document.getElementById('add-btn').addEventListener('click', addMeal);
  document.getElementById('prep-start-btn').addEventListener('click', startSoakTimer);
  document.getElementById('save-btn').addEventListener('click', saveLog);
  document.getElementById('clear-btn').addEventListener('click', clearAll);
  document.getElementById('history-btn').addEventListener('click', openHistory);
  document.getElementById('drawer-close').addEventListener('click', closeHistory);
  document.getElementById('drawer-overlay').addEventListener('click', closeHistory);

  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }

  document.addEventListener('click', e => {
    const menu = document.getElementById('user-menu');
    const avatar = document.getElementById('avatar-btn');
    if (!menu.contains(e.target) && e.target !== avatar) {
      menu.style.display = 'none';
    }
    if (!e.target.closest('.select-wrap')) {
      document.querySelectorAll('.custom-dropdown').forEach(d => d.classList.remove('open'));
    }
  });
}

/* ─── Boot ─── */
init();
