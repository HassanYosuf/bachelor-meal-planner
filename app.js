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

function switchAuthTab(mode) {
  authMode = mode;
  document.getElementById('tab-signin').classList.toggle('active', mode === 'signin');
  document.getElementById('tab-signup').classList.toggle('active', mode === 'signup');
  document.getElementById('signup-name-row').style.display = mode === 'signup' ? 'block' : 'none';
  document.getElementById('auth-submit-btn').textContent = mode === 'signin' ? 'Sign in' : 'Create account';
  document.getElementById('auth-error').textContent = '';
}

async function submitAuth() {
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  const errEl = document.getElementById('auth-error');
  const btn = document.getElementById('auth-submit-btn');
  errEl.textContent = '';

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
    errEl.style.color = 'var(--green)';
    errEl.textContent = 'Check your email to confirm your account.';
  }
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
  db.auth.onAuthStateChange(async (event, session) => {
    if (session) {
      currentUser = session.user;
      await showApp();
    } else {
      currentUser = null;
      showAuthScreen();
    }
  });

  const { data: { session } } = await db.auth.getSession();
  if (!session) showAuthScreen();
}

function showAuthScreen() {
  document.getElementById('auth-screen').style.display = 'flex';
  document.getElementById('app').style.display = 'none';
}

async function showApp() {
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  setDate();
  setupListeners();

  document.getElementById('avatar-btn').textContent = userInitial(currentUser);
  document.getElementById('user-menu-email').textContent = currentUser.email;

  await loadMeals();
  await loadTodayLog();
  await loadHouseholdSilent();
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
  allMeals = data;
  populateDropdown('meal-drop', data);
  populateDropdown('week-meal-drop', data);
}

function populateDropdown(id, meals) {
  const drop = document.getElementById(id);
  const groups = {};
  meals.forEach(m => {
    if (!groups[m.category]) groups[m.category] = [];
    groups[m.category].push(m);
  });
  drop.innerHTML = '<option value="">Choose a meal...</option>';
  Object.keys(groups).sort().forEach(cat => {
    const og = document.createElement('optgroup');
    og.label = cat;
    groups[cat].forEach(m => {
      const op = document.createElement('option');
      op.value = m.id;
      op.textContent = m.name + (m.soak_mins ? ' ⏱' : '');
      og.appendChild(op);
    });
    drop.appendChild(og);
  });
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
  const id = document.getElementById('meal-drop').value;
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
  const id = document.getElementById('meal-drop').value;
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
  document.getElementById('meal-drop').value = '';
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
  const myPlan = (weekPlanData[currentUser.id] || {})[dayIdx] || {};

  document.getElementById('week-slots').innerHTML = `
    <div class="week-slots-title">
      ${dayName(dayIdx)}, ${dayDate(currentWeekStart, dayIdx).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
    </div>
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

  // Roommates' plans for this day
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
}

function openWeekModal(dayIdx, mealType) {
  weekModalTarget = { dayIdx, mealType };
  const labels = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack' };
  document.getElementById('week-modal-title').textContent =
    `Add ${labels[mealType]} · ${dayName(dayIdx)}`;
  document.getElementById('week-meal-drop').value = '';
  document.getElementById('week-modal-overlay').style.display = 'block';
  document.getElementById('week-modal').classList.add('open');
}

function closeWeekModal() {
  document.getElementById('week-modal-overlay').style.display = 'none';
  document.getElementById('week-modal').classList.remove('open');
  weekModalTarget = null;
}

async function confirmAddToWeek() {
  if (!weekModalTarget) return;
  const mealId = document.getElementById('week-meal-drop').value;
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

  const { data: members } = await db
    .from('household_members')
    .select('user_id, display_name')
    .eq('household_id', memberships[0].household_id);

  householdMembers = (members || []).filter(m => m.user_id !== currentUser.id);
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
  const [{ data: hData }, { data: members }] = await Promise.all([
    db.from('households').select('*').eq('id', hId).single(),
    db.from('household_members').select('user_id, display_name, joined_at').eq('household_id', hId),
  ]);

  householdData = hData;
  householdMembers = (members || []).filter(m => m.user_id !== currentUser.id);

  renderHousehold(hData, members || []);
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

function renderHousehold(h, members) {
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
      <p class="household-hint">Share this code with roommates so they can join and see your week plan.</p>
    </section>
    <section class="section">
      <div class="section-label">Members (${members.length})</div>
      ${members.map(m => `
        <div class="member-row">
          <div class="roommate-avatar">${(m.display_name || '?')[0].toUpperCase()}</div>
          <div class="member-info">
            <div class="member-name">${m.display_name || 'Member'}${m.user_id === currentUser.id ? ' (you)' : ''}</div>
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
  const { error: e2 } = await db.from('household_members').insert({
    household_id: h.id,
    user_id: currentUser.id,
    display_name: myName,
  });
  if (e2) { showToast('Already a member or error occurred'); return; }

  householdData = h;
  showToast('Joined ' + h.name + '!');
  await loadHouseholdSilent();
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
  showToast('Left household');
  loadHouseholdView();
}

function copyCode(code) {
  navigator.clipboard.writeText(code).then(() => showToast('Code copied!'));
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
    });
  });

  document.getElementById('meal-drop').addEventListener('change', onMealSelect);
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
  });
}

/* ─── Boot ─── */
init();
