import { state } from '../../core/state.js';
import { showToast } from '../../utils/toast.js';
import { fmtTime } from '../../utils/format.js';
import { populateDropdown, toggleDropdown } from '../../utils/dropdown.js';
import {
  fetchMeals, fetchTodayLog, insertMealLog, deleteMealLog,
  deleteMealLogs, upsertDailySummary, fetchDailySummaries, fetchMealLogsByDate,
} from './meals.service.js';

export { populateDropdown, toggleDropdown };

export function setDate() {
  document.getElementById('hdr-date').textContent = state.today.toLocaleDateString('en-IN', {
    weekday: 'short', day: 'numeric', month: 'short',
  });
}

export async function loadMeals() {
  const { data, error } = await fetchMeals();
  if (error) { showToast('Could not load meals'); return; }
  state.allMeals = data || [];
  populateDropdown('meal-drop', state.allMeals.filter(m => m.meal_type === state.selectedType), () => onMealSelect());
}

export async function loadTodayLog() {
  const { data, error } = await fetchTodayLog(state.currentUser.id, state.todayStr);
  if (error) return;
  state.loggedMeals = data || [];
  renderLog();
  updateStats();
}

export function onMealSelect() {
  const id = document.getElementById('meal-drop-btn').dataset.value;
  if (!id) {
    document.getElementById('meal-preview').style.display = 'none';
    document.getElementById('prep-alert').style.display = 'none';
    return;
  }
  const meal = state.allMeals.find(m => m.id === id);
  if (!meal) return;

  document.getElementById('preview-icon').textContent = meal.icon || '🍽';
  document.getElementById('preview-name').textContent = meal.name;
  document.getElementById('preview-meta').textContent = `~${meal.cal_estimate} kcal · ${meal.category}`;
  document.getElementById('meal-preview').style.display = 'flex';

  if (meal.soak_mins) {
    document.getElementById('prep-title').textContent = meal.name + ' — prep needed';
    document.getElementById('prep-msg').textContent = meal.soak_msg;
    state.soakRemaining = meal.soak_mins * 60;
    document.getElementById('prep-countdown').textContent = fmtTime(state.soakRemaining);
    document.getElementById('prep-start-btn').disabled = false;
    document.getElementById('prep-start-btn').textContent = 'Start timer';
    state.currentPrepMeal = meal;
    if (state.soakTimer) { clearInterval(state.soakTimer); state.soakTimer = null; }
    document.getElementById('prep-alert').style.display = 'block';
  } else {
    document.getElementById('prep-alert').style.display = 'none';
    state.currentPrepMeal = null;
    if (state.soakTimer) { clearInterval(state.soakTimer); state.soakTimer = null; }
  }
}

export async function addMeal() {
  const id = document.getElementById('meal-drop-btn').dataset.value;
  if (!id) { showToast('Select a meal first'); return; }
  const meal = state.allMeals.find(m => m.id === id);
  if (!meal) return;

  const already = state.loggedMeals.find(l => l.meal_id === id && l.meal_type === state.selectedType);
  if (already) { showToast('Already added for ' + state.selectedType); return; }

  const entry = {
    log_date: state.todayStr,
    meal_id: meal.id,
    meal_name: meal.name,
    meal_type: state.selectedType,
    cal_estimate: meal.cal_estimate,
    user_id: state.currentUser.id,
  };

  const { data, error } = await insertMealLog(entry);
  if (error) { showToast('Could not save meal'); return; }

  state.loggedMeals.push(data);
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

export async function removeMeal(logId) {
  const { error } = await deleteMealLog(logId);
  if (error) { showToast('Could not remove'); return; }
  state.loggedMeals = state.loggedMeals.filter(m => m.id !== logId);
  renderLog();
  updateStats();
  await upsertSummary();
}

export async function clearAll() {
  if (!state.loggedMeals.length) return;
  const ids = state.loggedMeals.map(m => m.id);
  const { error } = await deleteMealLogs(ids);
  if (error) { showToast('Could not clear'); return; }
  state.loggedMeals = [];
  renderLog();
  updateStats();
  await upsertSummary();
  showToast('Log cleared');
}

export async function saveLog() {
  if (!state.loggedMeals.length) { showToast('No meals to save'); return; }
  await upsertSummary();
  showToast("Today's log saved!");
}

export async function upsertSummary() {
  const total_meals = state.loggedMeals.length;
  const total_cal = state.loggedMeals.reduce((s, m) => s + (m.cal_estimate || 0), 0);
  await upsertDailySummary({
    log_date: state.todayStr,
    total_meals,
    total_cal,
    updated_at: new Date().toISOString(),
    user_id: state.currentUser.id,
  });
}

export function renderLog() {
  const logList = document.getElementById('log-list');
  const saveBtn = document.getElementById('save-btn');
  const clearBtn = document.getElementById('clear-btn');

  if (!state.loggedMeals.length) {
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
  const mealData = id => state.allMeals.find(m => m.id === id) || {};

  logList.innerHTML = state.loggedMeals.map(l => {
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

export function updateStats() {
  const totalCal = state.loggedMeals.reduce((s, m) => s + (m.cal_estimate || 0), 0);
  const prepCount = state.loggedMeals.filter(l => {
    const m = state.allMeals.find(x => x.id === l.meal_id);
    return m && m.soak_mins;
  }).length;
  document.getElementById('s-meals').textContent = state.loggedMeals.length;
  document.getElementById('s-cal').textContent = totalCal;
  document.getElementById('s-prep').textContent = prepCount;
}

export function startSoakTimer() {
  if (state.soakTimer) clearInterval(state.soakTimer);
  const btn = document.getElementById('prep-start-btn');
  btn.disabled = true;
  btn.textContent = 'Running…';

  state.soakTimer = setInterval(() => {
    state.soakRemaining--;
    document.getElementById('prep-countdown').textContent = fmtTime(state.soakRemaining);
    if (state.soakRemaining <= 0) {
      clearInterval(state.soakTimer);
      state.soakTimer = null;
      document.getElementById('prep-countdown').textContent = 'Done!';
      onPrepDone(state.currentPrepMeal);
    }
  }, 1000);
}

export function onPrepDone(meal) {
  const msg = meal ? meal.name + ' is ready to cook!' : 'Prep time is done!';
  document.getElementById('notif-text').textContent = msg;
  const bar = document.getElementById('notif-bar');
  bar.style.display = 'flex';
  setTimeout(() => { bar.style.display = 'none'; }, 5000);
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification('Meal prep done! 🍳', { body: msg });
  }
}

export async function openHistory() {
  document.getElementById('drawer-overlay').classList.add('open');
  document.getElementById('history-drawer').classList.add('open');

  const histList = document.getElementById('history-list');
  histList.innerHTML = `<div class="loading-spinner"><div class="spinner"></div><span>Loading history...</span></div>`;

  const { data, error } = await fetchDailySummaries(state.currentUser.id);

  if (error || !data || !data.length) {
    histList.innerHTML = '<p style="color:var(--text-3);font-size:13px;padding:8px 0">No history yet.</p>';
    return;
  }

  const logs = await Promise.all(data.map(async day => {
    const { data: meals } = await fetchMealLogsByDate(state.currentUser.id, day.log_date);
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

export function closeHistory() {
  document.getElementById('drawer-overlay').classList.remove('open');
  document.getElementById('history-drawer').classList.remove('open');
}

export function setupListeners() {
  document.querySelectorAll('.type-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.type-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.selectedType = btn.dataset.type;
      const filtered = state.allMeals.filter(m => m.meal_type === state.selectedType);
      populateDropdown('meal-drop', filtered, () => onMealSelect());
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
