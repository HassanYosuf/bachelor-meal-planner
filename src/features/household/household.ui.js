import { state } from '../../core/state.js';
import { showToast } from '../../utils/toast.js';
import { weekStartStr, getMonday } from '../../utils/date.js';
import { db } from '../../core/supabase.js';
import {
  fetchUserMembership, fetchHouseholdMembers, fetchHousehold,
  fetchWeekRotation, insertHousehold, insertMember,
  fetchHouseholdByCode, fetchMaxRotationOrder, deleteMember,
} from './household.service.js';
import { ensureDecisionMaker } from '../collaborative/collaborative.service.js';
import { calculateWinningMeal } from '../collaborative/collaborative.ui.js';
import { renderWeekSlots, fetchWeekPlan } from '../week-plan/weekPlan.ui.js';

export async function loadHouseholdSilent() {
  const { data: memberships, error } = await fetchUserMembership(state.currentUser.id);

  if (error || !memberships || !memberships.length) return;

  const hId = memberships[0].household_id;
  state.householdData = state.householdData || { id: hId };

  const { data: members } = await fetchHouseholdMembers(hId);

  const allM = members || [];
  state.selfMember = allM.find(m => m.user_id === state.currentUser.id) || null;
  state.householdMembers = allM.filter(m => m.user_id !== state.currentUser.id);
}

export function setupHouseholdRealtime() {
  if (state.weekPlanChannel) { db.removeChannel(state.weekPlanChannel); state.weekPlanChannel = null; }
  if (state.collaborativeChannel) { db.removeChannel(state.collaborativeChannel); state.collaborativeChannel = null; }

  if (!state.householdMembers.length && !state.householdData) return;

  state.weekPlanChannel = db
    .channel('household-week-plans')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'week_plans' }, (payload) => {
      const changedUserId = payload.new?.user_id || payload.old?.user_id;
      if (changedUserId && changedUserId !== state.currentUser.id) {
        if (state.currentView === 'week') fetchWeekPlan().then(renderWeekSlots);
      }
    })
    .subscribe();

  if (!state.householdData) return;

  state.collaborativeChannel = db
    .channel('collab-' + state.householdData.id)
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'week_slots', filter: `household_id=eq.${state.householdData.id}` },
      (payload) => {
        const s = payload.new || payload.old;
        if (!s) return;
        const key = `${s.day_of_week}-${s.meal_type}`;
        if (payload.eventType === 'DELETE') delete state.currentWeekSlots[key];
        else state.currentWeekSlots[key] = s;
        if (state.currentView === 'week') renderWeekSlots();
      })
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'meal_suggestions' },
      (payload) => {
        const s = payload.new;
        if (!s || s.suggested_by === state.currentUser.id) return;
        const isOurSlot = Object.values(state.currentWeekSlots).some(sl => sl.id === s.slot_id);
        if (!isOurSlot) return;
        if (!state.slotSuggestions[s.slot_id]) state.slotSuggestions[s.slot_id] = [];
        if (!state.slotSuggestions[s.slot_id].find(x => x.id === s.id)) {
          state.slotSuggestions[s.slot_id].push(s);
        }
        if (state.currentView === 'week') renderWeekSlots();
      })
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'meal_votes' },
      async (payload) => {
        const v = payload.new || payload.old;
        if (!v || v.user_id === state.currentUser.id) return;
        const isOurSlot = Object.values(state.currentWeekSlots).some(sl => sl.id === v.slot_id);
        if (!isOurSlot) return;
        if (!state.slotVotes[v.slot_id]) state.slotVotes[v.slot_id] = [];
        if (payload.eventType === 'DELETE') {
          state.slotVotes[v.slot_id] = state.slotVotes[v.slot_id].filter(x => x.id !== v.id);
        } else {
          state.slotVotes[v.slot_id] = state.slotVotes[v.slot_id].filter(x => x.user_id !== v.user_id);
          state.slotVotes[v.slot_id].push(v);
        }
        if (state.currentView === 'week') {
          await calculateWinningMeal(v.slot_id);
          renderWeekSlots();
        }
      })
    .subscribe();
}

export async function loadHouseholdView() {
  const el = document.getElementById('household-content');
  el.innerHTML = `<div style="padding:24px"><div class="loading-spinner"><div class="spinner"></div><span>Loading...</span></div></div>`;

  const { data: memberships, error: memErr } = await fetchUserMembership(state.currentUser.id);

  if (memErr || !memberships || !memberships.length) {
    renderNoHousehold();
    return;
  }

  const hId = memberships[0].household_id;
  const wStart = weekStartStr(getMonday(new Date()));
  const [hhRes, memRes, rotRes] = await Promise.all([
    fetchHousehold(hId),
    fetchHouseholdMembers(hId),
    fetchWeekRotation(hId, wStart),
  ]);

  if (hhRes.error || !hhRes.data) { renderNoHousehold(); return; }

  state.householdData = hhRes.data;
  const allM = memRes.data || [];
  state.selfMember = allM.find(m => m.user_id === state.currentUser.id) || null;
  state.householdMembers = allM.filter(m => m.user_id !== state.currentUser.id);
  state.currentDM = rotRes.data ? rotRes.data.decision_maker_user_id : null;
  if (!state.currentDM) await ensureDecisionMaker();

  renderHousehold(hhRes.data, allM, state.currentDM);
}

export function renderNoHousehold() {
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

export function renderHousehold(h, members, dmUserId) {
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
          <div class="dm-name">${dmMember ? dmMember.display_name || 'Unknown' : 'Unknown'}${dmUserId === state.currentUser.id ? ' (you)' : ''}</div>
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
            <div class="member-name">${m.display_name || 'Member'}${m.user_id === state.currentUser.id ? ' (you)' : ''}${m.user_id === dmUserId ? '<span class="member-dm-badge">DM</span>' : ''}</div>
            <div class="member-since">Joined ${new Date(m.joined_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</div>
          </div>
        </div>`).join('')}
    </section>
    <section class="section">
      <button class="clear-btn" onclick="leaveHousehold()">Leave household</button>
    </section>`;
}

export async function createHousehold() {
  const name = document.getElementById('hh-name').value.trim();
  if (!name) { showToast('Enter a name'); return; }

  const { data: h, error: e1 } = await insertHousehold(name, state.currentUser.id);
  if (e1) { showToast('Could not create'); return; }

  const myName = (state.currentUser.user_metadata && state.currentUser.user_metadata.name) || state.currentUser.email;
  const { error: e2 } = await insertMember({
    household_id: h.id,
    user_id: state.currentUser.id,
    display_name: myName,
    rotation_order: 1,
  });
  if (e2) { showToast('Error joining household'); return; }

  state.householdData = h;
  state.householdMembers = [];
  showToast('Household created!');
  loadHouseholdView();
}

export async function joinHousehold() {
  const code = document.getElementById('hh-code').value.trim().toLowerCase();
  if (!code) { showToast('Enter a code'); return; }

  const { data: h, error } = await fetchHouseholdByCode(code);
  if (error || !h) { showToast('Invalid invite code'); return; }

  const myName = (state.currentUser.user_metadata && state.currentUser.user_metadata.name) || state.currentUser.email;
  const { data: existingM } = await fetchMaxRotationOrder(h.id);
  const maxOrder = (existingM && existingM[0] && existingM[0].rotation_order) || 0;

  const { error: e2 } = await insertMember({
    household_id: h.id,
    user_id: state.currentUser.id,
    display_name: myName,
    rotation_order: maxOrder + 1,
  });
  if (e2) { showToast('Already a member or error occurred'); return; }

  state.householdData = h;
  showToast('Joined ' + h.name + '!');
  await loadHouseholdSilent();
  setupHouseholdRealtime();
  loadHouseholdView();
}

export async function leaveHousehold() {
  if (!state.householdData) return;
  const { error } = await deleteMember(state.householdData.id, state.currentUser.id);
  if (error) { showToast('Could not leave'); return; }

  state.householdData = null;
  state.householdMembers = [];
  state.selfMember = null;
  state.currentDM = null;
  state.currentWeekSlots = {};
  state.slotSuggestions = {};
  state.slotVotes = {};

  if (state.weekPlanChannel) { db.removeChannel(state.weekPlanChannel); state.weekPlanChannel = null; }
  if (state.collaborativeChannel) { db.removeChannel(state.collaborativeChannel); state.collaborativeChannel = null; }

  showToast('Left household');
  loadHouseholdView();
}

export function copyCode(code) {
  navigator.clipboard.writeText(code).then(() => showToast('Code copied!'));
}
