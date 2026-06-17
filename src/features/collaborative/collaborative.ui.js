import { state } from '../../core/state.js';
import { showToast } from '../../utils/toast.js';
import { populateDropdown } from '../../utils/dropdown.js';
import { dayName } from '../../utils/date.js';
import { allMembersAll, getOrCreateSlot } from './collaborative.service.js';
import { db } from '../../core/supabase.js';
import { renderWeekSlots } from '../week-plan/weekPlan.ui.js';

export function renderCollabSlot(dayIdx, mealType, labels) {
  const key = `${dayIdx}-${mealType}`;
  const slot = state.currentWeekSlots[key];
  const label = labels[mealType];
  const iAmDM = state.currentDM === state.currentUser.id;

  if (slot && slot.status === 'FINALIZED') {
    const meal = state.allMeals.find(m => m.id === slot.selected_meal_id);
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

  if (slot && slot.status === 'TIE_PENDING') {
    const suggestions = state.slotSuggestions[slot.id] || [];
    const votes = state.slotVotes[slot.id] || [];
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
          const meal = state.allMeals.find(m => m.id === s.meal_id);
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
          : `<div class="collab-waiting-hint">Waiting for ${(allMembersAll().find(m => m.user_id === state.currentDM) || {}).display_name || 'DM'} to decide</div>`}
      </div>`;
  }

  const slotId = slot ? slot.id : null;
  const suggestions = slotId ? (state.slotSuggestions[slotId] || []) : [];
  const votes = slotId ? (state.slotVotes[slotId] || []) : [];
  const myVote = votes.find(v => v.user_id === state.currentUser.id);
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
            const meal = state.allMeals.find(m => m.id === s.meal_id);
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

export async function openSuggestModal(dayIdx, mealType) {
  if (!state.householdData) return;
  const slot = await getOrCreateSlot(dayIdx, mealType);
  if (!slot) { showToast('Could not open slot'); return; }
  state.suggestModalTarget = { dayIdx, mealType, slotId: slot.id };
  const labels = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack' };
  document.getElementById('suggest-modal-title').textContent =
    `Suggest ${labels[mealType]} · ${dayName(dayIdx)}`;
  populateDropdown('suggest-meal-drop', state.allMeals.filter(m => m.meal_type === mealType));
  document.getElementById('suggest-modal-overlay').style.display = 'block';
  document.getElementById('suggest-modal').classList.add('open');
}

export function closeSuggestModal() {
  document.getElementById('suggest-modal-overlay').style.display = 'none';
  document.getElementById('suggest-modal').classList.remove('open');
  document.querySelectorAll('.custom-dropdown').forEach(d => d.classList.remove('open'));
  const btn = document.getElementById('suggest-meal-drop-btn');
  btn.textContent = 'Choose a meal...';
  btn.dataset.value = '';
  state.suggestModalTarget = null;
}

export async function confirmSuggestMeal() {
  if (!state.suggestModalTarget) return;
  const mealId = document.getElementById('suggest-meal-drop-btn').dataset.value;
  if (!mealId) { showToast('Select a meal'); return; }
  await submitSuggestion(state.suggestModalTarget.slotId, mealId);
}

export async function submitSuggestion(slotId, mealId) {
  const meal = state.allMeals.find(m => m.id === mealId);
  if (!meal) return;

  const { data, error } = await db.from('meal_suggestions').insert({
    slot_id: slotId,
    meal_id: mealId,
    suggested_by: state.currentUser.id,
  }).select().single();

  if (error) {
    showToast(error.code === '23505' ? 'Already suggested' : 'Could not suggest');
    return;
  }

  if (!state.slotSuggestions[slotId]) state.slotSuggestions[slotId] = [];
  state.slotSuggestions[slotId].push(data);
  closeSuggestModal();
  renderWeekSlots();
  showToast(meal.name + ' suggested!');
}

export async function submitVote(slotId, suggestionId) {
  const slot = Object.values(state.currentWeekSlots).find(s => s.id === slotId);
  if (slot && slot.status === 'FINALIZED') { showToast('Voting is closed'); return; }

  await db.from('meal_votes').delete().eq('slot_id', slotId).eq('user_id', state.currentUser.id);

  const { data, error } = await db.from('meal_votes').insert({
    slot_id: slotId,
    suggestion_id: suggestionId,
    user_id: state.currentUser.id,
  }).select().single();

  if (error) { showToast('Could not vote'); return; }

  if (!state.slotVotes[slotId]) state.slotVotes[slotId] = [];
  state.slotVotes[slotId] = state.slotVotes[slotId].filter(v => v.user_id !== state.currentUser.id);
  state.slotVotes[slotId].push(data);

  await calculateWinningMeal(slotId);
  renderWeekSlots();
}

export async function calculateWinningMeal(slotId) {
  const slot = Object.values(state.currentWeekSlots).find(s => s.id === slotId);
  if (!slot || slot.status === 'FINALIZED') return;

  const votes = state.slotVotes[slotId] || [];
  const suggestions = state.slotSuggestions[slotId] || [];
  if (!votes.length || !suggestions.length) return;

  const tally = {};
  votes.forEach(v => { tally[v.suggestion_id] = (tally[v.suggestion_id] || 0) + 1; });
  const maxVotes = Math.max(...Object.values(tally));
  const winners = suggestions.filter(s => (tally[s.id] || 0) === maxVotes);

  const totalMembers = state.householdMembers.length + 1;
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

  const key = Object.keys(state.currentWeekSlots).find(k => state.currentWeekSlots[k].id === slotId);
  if (key) state.currentWeekSlots[key] = data;

  if (newStatus === 'FINALIZED') {
    const meal = state.allMeals.find(m => m.id === selectedMealId);
    showToast((meal ? meal.name : 'Meal') + ' won the vote! 🎉');
  } else {
    const dm = allMembersAll().find(m => m.user_id === state.currentDM);
    showToast('Tie! ' + (dm ? dm.display_name : 'DM') + ' must decide');
  }
}

export async function resolveTie(slotId, mealId) {
  if (state.currentDM !== state.currentUser.id) { showToast('Only the decision maker can resolve ties'); return; }

  const { data, error } = await db.from('week_slots')
    .update({ status: 'FINALIZED', selected_meal_id: mealId, selection_type: 'TIE_BREAKER', selected_by: state.currentUser.id })
    .eq('id', slotId).select().single();

  if (error) { showToast('Could not resolve tie'); return; }

  const key = Object.keys(state.currentWeekSlots).find(k => state.currentWeekSlots[k].id === slotId);
  if (key) state.currentWeekSlots[key] = data;

  closeResolveModal();
  renderWeekSlots();
  const meal = state.allMeals.find(m => m.id === mealId);
  showToast((meal ? meal.name : 'Meal') + ' selected!');
}

export function openResolveModal(slotId) {
  state.resolveModalTarget = { slotId };
  renderResolveTieOptions(slotId);
  document.getElementById('resolve-modal-overlay').style.display = 'block';
  document.getElementById('resolve-modal').classList.add('open');
}

export function closeResolveModal() {
  document.getElementById('resolve-modal-overlay').style.display = 'none';
  document.getElementById('resolve-modal').classList.remove('open');
  state.resolveModalTarget = null;
}

export function renderResolveTieOptions(slotId) {
  const suggestions = state.slotSuggestions[slotId] || [];
  const votes = state.slotVotes[slotId] || [];
  const tally = {};
  votes.forEach(v => { tally[v.suggestion_id] = (tally[v.suggestion_id] || 0) + 1; });
  const maxVotes = Math.max(...Object.values(tally), 0);
  const tied = suggestions.filter(s => (tally[s.id] || 0) === maxVotes);

  document.getElementById('resolve-options-list').innerHTML = tied.map(s => {
    const meal = state.allMeals.find(m => m.id === s.meal_id);
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
