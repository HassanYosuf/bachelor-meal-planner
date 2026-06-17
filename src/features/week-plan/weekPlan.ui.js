import { state } from '../../core/state.js';
import { showToast } from '../../utils/toast.js';
import { populateDropdown } from '../../utils/dropdown.js';
import { weekStartStr, dayName, dayDate, isThisWeek, todayDayOfWeek } from '../../utils/date.js';
import { fetchWeekPlanData, upsertWeekPlan, deleteWeekPlan } from './weekPlan.service.js';
import { renderCollabSlot } from '../collaborative/collaborative.ui.js';
import { fetchCollaborativeData, ensureDecisionMaker, allMembersAll } from '../collaborative/collaborative.service.js';

export async function loadWeekView() {
  renderWeekHeader();
  renderWeekDayTabs();
  await fetchWeekPlan();
  if (state.householdData) {
    await Promise.all([fetchCollaborativeData(), ensureDecisionMaker()]);
  }
  renderWeekSlots();
}

export function renderWeekHeader() {
  const end = dayDate(state.currentWeekStart, 6);
  const fmt = d => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  document.getElementById('week-label').textContent =
    fmt(state.currentWeekStart) + ' – ' + fmt(end);
}

export function renderWeekDayTabs() {
  const todayIdx = isThisWeek(state.currentWeekStart) ? todayDayOfWeek() : -1;
  document.getElementById('week-day-tabs').innerHTML =
    ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((name, i) => {
      const dateNum = dayDate(state.currentWeekStart, i).getDate();
      const isToday = i === todayIdx;
      const isSelected = i === state.selectedWeekDayIdx;
      return `
        <button class="week-day-tab${isSelected ? ' active' : ''}${isToday ? ' today' : ''}" onclick="selectWeekDay(${i})">
          <span class="week-day-name">${name}</span>
          <span class="week-day-num">${dateNum}</span>
        </button>`;
    }).join('');
}

export function selectWeekDay(idx) {
  state.selectedWeekDayIdx = idx;
  renderWeekDayTabs();
  renderWeekSlots();
}

export async function fetchWeekPlan() {
  const wStart = weekStartStr(state.currentWeekStart);
  const userIds = [state.currentUser.id, ...state.householdMembers.map(m => m.user_id)];

  const { data } = await fetchWeekPlanData(wStart, userIds);

  state.weekPlanData = {};
  if (data) {
    data.forEach(entry => {
      if (!state.weekPlanData[entry.user_id]) state.weekPlanData[entry.user_id] = {};
      if (!state.weekPlanData[entry.user_id][entry.day_of_week]) state.weekPlanData[entry.user_id][entry.day_of_week] = {};
      state.weekPlanData[entry.user_id][entry.day_of_week][entry.meal_type] = entry;
    });
  }
}

export function renderWeekSlots() {
  const dayIdx = state.selectedWeekDayIdx;
  const mealTypes = ['breakfast', 'lunch', 'dinner', 'snack'];
  const labels = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack' };
  const dateStr = dayDate(state.currentWeekStart, dayIdx).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

  // ── Solo path (no household) ──────────────────────────────────────────
  if (!state.householdData) {
    const myPlan = (state.weekPlanData[state.currentUser.id] || {})[dayIdx] || {};
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

    document.getElementById('roommate-plans').innerHTML = state.householdMembers.map(member => {
      const memberPlan = (state.weekPlanData[member.user_id] || {})[dayIdx] || {};
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

  // ── Household collaborative path ──────────────────────────────────────
  document.getElementById('roommate-plans').innerHTML = '';

  const iAmDM = state.currentDM === state.currentUser.id;
  const dmMember = allMembersAll().find(m => m.user_id === state.currentDM);
  const dmName = dmMember ? dmMember.display_name : 'someone';

  document.getElementById('week-slots').innerHTML = `
    <div class="week-slots-title">${dayName(dayIdx)}, ${dateStr}</div>
    <div class="collab-dm-banner">
      🎯 This week's decision maker: <strong>${dmName}</strong>${iAmDM ? ' (you)' : ''}
    </div>
    ${mealTypes.map(type => renderCollabSlot(dayIdx, type, labels)).join('')}`;
}

export function openWeekModal(dayIdx, mealType) {
  state.weekModalTarget = { dayIdx, mealType };
  const labels = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack' };
  document.getElementById('week-modal-title').textContent =
    `Add ${labels[mealType]} · ${dayName(dayIdx)}`;
  populateDropdown('week-meal-drop', state.allMeals.filter(m => m.meal_type === mealType));
  document.getElementById('week-modal-overlay').style.display = 'block';
  document.getElementById('week-modal').classList.add('open');
}

export function closeWeekModal() {
  document.getElementById('week-modal-overlay').style.display = 'none';
  const modal = document.getElementById('week-modal');
  modal.classList.remove('open');
  document.querySelectorAll('.custom-dropdown').forEach(d => d.classList.remove('open'));
  const btn = document.getElementById('week-meal-drop-btn');
  btn.textContent = 'Choose a meal...';
  btn.dataset.value = '';
  state.weekModalTarget = null;
}

export async function confirmAddToWeek() {
  if (!state.weekModalTarget) return;
  const mealId = document.getElementById('week-meal-drop-btn').dataset.value;
  if (!mealId) { showToast('Select a meal'); return; }

  const meal = state.allMeals.find(m => m.id === mealId);
  if (!meal) return;

  const { dayIdx, mealType } = state.weekModalTarget;

  const { data, error } = await upsertWeekPlan({
    user_id: state.currentUser.id,
    week_start: weekStartStr(state.currentWeekStart),
    day_of_week: dayIdx,
    meal_type: mealType,
    meal_id: meal.id,
    meal_name: meal.name,
    cal_estimate: meal.cal_estimate,
    icon: meal.icon,
  });

  if (error) { showToast('Could not save'); return; }

  if (!state.weekPlanData[state.currentUser.id]) state.weekPlanData[state.currentUser.id] = {};
  if (!state.weekPlanData[state.currentUser.id][dayIdx]) state.weekPlanData[state.currentUser.id][dayIdx] = {};
  state.weekPlanData[state.currentUser.id][dayIdx][mealType] = data;

  closeWeekModal();
  renderWeekSlots();
  showToast(meal.name + ' added to plan');
}

export async function removeFromWeekPlan(id, dayIdx, mealType) {
  const { error } = await deleteWeekPlan(id);
  if (error) { showToast('Could not remove'); return; }

  if (state.weekPlanData[state.currentUser.id] && state.weekPlanData[state.currentUser.id][dayIdx]) {
    delete state.weekPlanData[state.currentUser.id][dayIdx][mealType];
  }
  renderWeekSlots();
}

export async function shiftWeek(dir) {
  const d = new Date(state.currentWeekStart);
  d.setDate(d.getDate() + dir * 7);
  state.currentWeekStart = d;
  state.selectedWeekDayIdx = isThisWeek(state.currentWeekStart) ? todayDayOfWeek() : 0;
  await loadWeekView();
}
