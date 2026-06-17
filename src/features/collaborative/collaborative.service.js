import { db } from '../../core/supabase.js';
import { state } from '../../core/state.js';
import { weekStartStr } from '../../utils/date.js';

export function allMembersAll() {
  const myName = (state.currentUser.user_metadata && state.currentUser.user_metadata.name) || state.currentUser.email;
  const me = state.selfMember
    ? { ...state.selfMember, display_name: state.selfMember.display_name || myName }
    : { user_id: state.currentUser.id, display_name: myName, rotation_order: null };
  return [me, ...state.householdMembers].sort((a, b) => (a.rotation_order || 99) - (b.rotation_order || 99));
}

export function getCurrentDecisionMaker() {
  const members = allMembersAll().filter(m => m.rotation_order != null);
  if (!members.length) return state.currentUser.id;
  const EPOCH_MONDAY = new Date('1970-01-05T00:00:00Z').getTime();
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const wStartUTC = new Date(weekStartStr(state.currentWeekStart) + 'T00:00:00Z').getTime();
  const weekNumber = Math.floor((wStartUTC - EPOCH_MONDAY) / weekMs);
  const idx = ((weekNumber % members.length) + members.length) % members.length;
  return members[idx].user_id;
}

export async function ensureDecisionMaker() {
  if (!state.householdData) return;
  const wStart = weekStartStr(state.currentWeekStart);

  const { data: existing } = await db
    .from('household_week_rotation')
    .select('decision_maker_user_id')
    .eq('household_id', state.householdData.id)
    .eq('week_start', wStart)
    .maybeSingle();

  if (existing) { state.currentDM = existing.decision_maker_user_id; return; }

  await db.from('household_week_rotation').insert({
    household_id: state.householdData.id,
    week_start: wStart,
    decision_maker_user_id: getCurrentDecisionMaker(),
  });

  const { data: confirmed } = await db
    .from('household_week_rotation')
    .select('decision_maker_user_id')
    .eq('household_id', state.householdData.id)
    .eq('week_start', wStart)
    .maybeSingle();

  state.currentDM = confirmed ? confirmed.decision_maker_user_id : null;
}

export async function fetchCollaborativeData() {
  if (!state.householdData) return;
  const wStart = weekStartStr(state.currentWeekStart);

  const { data: slots } = await db
    .from('week_slots')
    .select('*')
    .eq('household_id', state.householdData.id)
    .eq('week_start', wStart);

  state.currentWeekSlots = {};
  const slotIds = [];
  (slots || []).forEach(s => {
    state.currentWeekSlots[`${s.day_of_week}-${s.meal_type}`] = s;
    slotIds.push(s.id);
  });

  if (!slotIds.length) { state.slotSuggestions = {}; state.slotVotes = {}; return; }

  const [sugRes, voteRes] = await Promise.all([
    db.from('meal_suggestions').select('*').in('slot_id', slotIds),
    db.from('meal_votes').select('*').in('slot_id', slotIds),
  ]);

  state.slotSuggestions = {};
  (sugRes.data || []).forEach(s => {
    if (!state.slotSuggestions[s.slot_id]) state.slotSuggestions[s.slot_id] = [];
    state.slotSuggestions[s.slot_id].push(s);
  });

  state.slotVotes = {};
  (voteRes.data || []).forEach(v => {
    if (!state.slotVotes[v.slot_id]) state.slotVotes[v.slot_id] = [];
    state.slotVotes[v.slot_id].push(v);
  });
}

export async function getOrCreateSlot(dayIdx, mealType) {
  const key = `${dayIdx}-${mealType}`;
  if (state.currentWeekSlots[key]) return state.currentWeekSlots[key];
  const wStart = weekStartStr(state.currentWeekStart);

  const { data: existing } = await db
    .from('week_slots').select('*')
    .eq('household_id', state.householdData.id)
    .eq('week_start', wStart)
    .eq('day_of_week', dayIdx)
    .eq('meal_type', mealType)
    .maybeSingle();

  if (existing) { state.currentWeekSlots[key] = existing; return existing; }

  const { data, error } = await db.from('week_slots').insert({
    household_id: state.householdData.id,
    week_start: wStart,
    day_of_week: dayIdx,
    meal_type: mealType,
  }).select().single();

  if (error) return null;
  state.currentWeekSlots[key] = data;
  return data;
}
