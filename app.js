/* ─── Supabase Config ─── */
const SUPABASE_URL = 'https://ecaakbixqzxaznrocyql.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVjYWFrYml4cXp4YXpucm9jeXFsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY0MzM2MjMsImV4cCI6MjA5MjAwOTYyM30.D1cC8xRU_shRcas-VHShWN1qNjEL5uFWY-IaG2BMmXM';

const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* ─── State ─── */
let allMeals = [];
let loggedMeals = [];
let selectedType = 'breakfast';
let soakTimer = null;
let soakRemaining = 0;
let currentPrepMeal = null;
const today = new Date();
const todayStr = today.toISOString().split('T')[0];

/* ─── DOM Refs ─── */
const mealDrop = document.getElementById('meal-drop');
const mealPreview = document.getElementById('meal-preview');
const previewIcon = document.getElementById('preview-icon');
const previewName = document.getElementById('preview-name');
const previewMeta = document.getElementById('preview-meta');
const prepAlert = document.getElementById('prep-alert');
const prepTitle = document.getElementById('prep-title');
const prepMsg = document.getElementById('prep-msg');
const prepCountdown = document.getElementById('prep-countdown');
const prepStartBtn = document.getElementById('prep-start-btn');
const logList = document.getElementById('log-list');
const notifBar = document.getElementById('notif-bar');
const notifText = document.getElementById('notif-text');
const saveBtn = document.getElementById('save-btn');
const clearBtn = document.getElementById('clear-btn');
const sMeals = document.getElementById('s-meals');
const sCal = document.getElementById('s-cal');
const sPrep = document.getElementById('s-prep');

/* ─── Init ─── */
async function init() {
  setDate();
  await loadMeals();
  await loadTodayLog();
  setupListeners();
  requestNotifPermission();
}

function setDate() {
  document.getElementById('hdr-date').textContent = today.toLocaleDateString('en-IN', {
    weekday: 'short', day: 'numeric', month: 'short'
  });
}

async function loadMeals() {
  const { data, error } = await db.from('meals').select('*').order('category').order('name');
  if (error) { showToast('Could not load meals'); return; }
  allMeals = data;
  populateDropdown(data);
}

function populateDropdown(meals) {
  const groups = {};
  meals.forEach(m => {
    if (!groups[m.category]) groups[m.category] = [];
    groups[m.category].push(m);
  });

  mealDrop.innerHTML = '<option value="">Choose a meal...</option>';
  Object.keys(groups).sort().forEach(cat => {
    const og = document.createElement('optgroup');
    og.label = cat;
    groups[cat].forEach(m => {
      const op = document.createElement('option');
      op.value = m.id;
      op.textContent = m.name + (m.soak_mins ? ' ⏱' : '');
      og.appendChild(op);
    });
    mealDrop.appendChild(og);
  });
}

async function loadTodayLog() {
  const { data, error } = await db
    .from('meal_logs')
    .select('*')
    .eq('log_date', todayStr)
    .order('logged_at');
  if (error) return;
  loggedMeals = data || [];
  renderLog();
  updateStats();
}

/* ─── Dropdown change ─── */
function onMealSelect() {
  const id = mealDrop.value;
  if (!id) { mealPreview.style.display = 'none'; prepAlert.style.display = 'none'; return; }

  const meal = allMeals.find(m => m.id === id);
  if (!meal) return;

  // Show preview
  previewIcon.textContent = meal.icon || '🍽';
  previewName.textContent = meal.name;
  previewMeta.textContent = `~${meal.cal_estimate} kcal · ${meal.category}`;
  mealPreview.style.display = 'flex';

  // Show/hide prep alert
  if (meal.soak_mins) {
    prepTitle.textContent = meal.name + ' — prep needed';
    prepMsg.textContent = meal.soak_msg;
    soakRemaining = meal.soak_mins * 60;
    prepCountdown.textContent = fmtTime(soakRemaining);
    prepStartBtn.disabled = false;
    prepStartBtn.textContent = 'Start timer';
    currentPrepMeal = meal;
    if (soakTimer) { clearInterval(soakTimer); soakTimer = null; }
    prepAlert.style.display = 'block';
  } else {
    prepAlert.style.display = 'none';
    currentPrepMeal = null;
    if (soakTimer) { clearInterval(soakTimer); soakTimer = null; }
  }
}

/* ─── Add Meal ─── */
async function addMeal() {
  const id = mealDrop.value;
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
  };

  const { data, error } = await db.from('meal_logs').insert(entry).select().single();
  if (error) { showToast('Could not save meal'); return; }

  loggedMeals.push(data);
  mealDrop.value = '';
  mealPreview.style.display = 'none';
  prepAlert.style.display = 'none';
  renderLog();
  updateStats();
  await upsertSummary();
  showToast(meal.name + ' added');
}

/* ─── Remove Meal ─── */
async function removeMeal(logId) {
  const { error } = await db.from('meal_logs').delete().eq('id', logId);
  if (error) { showToast('Could not remove'); return; }
  loggedMeals = loggedMeals.filter(m => m.id !== logId);
  renderLog();
  updateStats();
  await upsertSummary();
}

/* ─── Clear All ─── */
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

/* ─── Save Summary ─── */
async function saveLog() {
  if (!loggedMeals.length) { showToast('No meals to save'); return; }
  await upsertSummary();
  showToast('Today\'s log saved!');
}

async function upsertSummary() {
  const total_meals = loggedMeals.length;
  const total_cal = loggedMeals.reduce((s, m) => s + (m.cal_estimate || 0), 0);
  await db.from('daily_summaries').upsert({
    log_date: todayStr, total_meals, total_cal, updated_at: new Date().toISOString()
  }, { onConflict: 'log_date' });
}

/* ─── Render Log ─── */
function renderLog() {
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
  const mealData = (id) => allMeals.find(m => m.id === id) || {};

  logList.innerHTML = loggedMeals.map(l => {
    const m = mealData(l.meal_id);
    const hasSoak = m.soak_mins;
    return `
      <div class="log-card${hasSoak ? ' has-prep' : ''}">
        <div class="log-emoji">${m.icon || '🍽'}</div>
        <div class="log-info">
          <div class="log-name">${l.meal_name}</div>
          <div class="log-meta">
            ~${l.cal_estimate} kcal · ${m.category || ''}
          </div>
        </div>
        <div class="log-right">
          ${hasSoak ? '<span class="prep-tag">prep</span>' : ''}
          <span class="type-pill ${pillClass[l.meal_type] || 'pill-dinner'}">${l.meal_type[0].toUpperCase()}</span>
          <button class="del-btn" onclick="removeMeal('${l.id}')" title="Remove">×</button>
        </div>
      </div>`;
  }).join('');

  saveBtn.style.display = 'flex';
  clearBtn.style.display = 'block';
}

/* ─── Update Stats ─── */
function updateStats() {
  const totalCal = loggedMeals.reduce((s, m) => s + (m.cal_estimate || 0), 0);
  const prepCount = loggedMeals.filter(l => {
    const m = allMeals.find(x => x.id === l.meal_id);
    return m && m.soak_mins;
  }).length;
  sMeals.textContent = loggedMeals.length;
  sCal.textContent = totalCal;
  sPrep.textContent = prepCount;
}

/* ─── Prep Timer ─── */
function startSoakTimer() {
  if (soakTimer) clearInterval(soakTimer);
  prepStartBtn.disabled = true;
  prepStartBtn.textContent = 'Running…';

  soakTimer = setInterval(() => {
    soakRemaining--;
    prepCountdown.textContent = fmtTime(soakRemaining);
    if (soakRemaining <= 0) {
      clearInterval(soakTimer);
      soakTimer = null;
      prepCountdown.textContent = 'Done!';
      onPrepDone(currentPrepMeal);
    }
  }, 1000);
}

function onPrepDone(meal) {
  const msg = meal ? meal.name + ' is ready to cook!' : 'Prep time is done!';
  notifText.textContent = msg;
  notifBar.style.display = 'flex';
  setTimeout(() => { notifBar.style.display = 'none'; }, 5000);

  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification('Meal prep done! 🍳', { body: msg, icon: '/icon.png' });
  }
}

function requestNotifPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
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
    .order('log_date', { ascending: false })
    .limit(30);

  if (error || !data.length) {
    histList.innerHTML = '<p style="color:var(--text-3);font-size:13px;padding:8px 0">No history yet.</p>';
    return;
  }

  const logs = await Promise.all(data.map(async (day) => {
    const { data: meals } = await db
      .from('meal_logs')
      .select('meal_name')
      .eq('log_date', day.log_date);
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
  // Meal type tabs
  document.querySelectorAll('.type-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.type-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedType = btn.dataset.type;
    });
  });

  // Dropdown
  mealDrop.addEventListener('change', onMealSelect);

  // Add button
  document.getElementById('add-btn').addEventListener('click', addMeal);

  // Prep timer
  prepStartBtn.addEventListener('click', startSoakTimer);

  // Save
  saveBtn.addEventListener('click', saveLog);

  // Clear
  clearBtn.addEventListener('click', clearAll);

  // History
  document.getElementById('history-btn').addEventListener('click', openHistory);
  document.getElementById('drawer-close').addEventListener('click', closeHistory);
  document.getElementById('drawer-overlay').addEventListener('click', closeHistory);
}

/* ─── Boot ─── */
init();
