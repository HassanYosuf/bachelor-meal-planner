import { db } from '../../core/supabase.js';

export async function fetchUserMembership(userId) {
  return db
    .from('household_members')
    .select('household_id, display_name')
    .eq('user_id', userId)
    .limit(1);
}

export async function fetchHouseholdMembers(householdId) {
  return db
    .from('household_members')
    .select('user_id, display_name, rotation_order, joined_at')
    .eq('household_id', householdId);
}

export async function fetchHousehold(id) {
  return db.from('households').select('*').eq('id', id).single();
}

export async function fetchWeekRotation(householdId, weekStart) {
  return db
    .from('household_week_rotation')
    .select('decision_maker_user_id')
    .eq('household_id', householdId)
    .eq('week_start', weekStart)
    .maybeSingle();
}

export async function insertHousehold(name, createdBy) {
  return db.from('households').insert({ name, created_by: createdBy }).select().single();
}

export async function insertMember(entry) {
  return db.from('household_members').insert(entry);
}

export async function fetchHouseholdByCode(code) {
  return db.from('households').select('*').eq('invite_code', code).single();
}

export async function fetchMaxRotationOrder(householdId) {
  return db
    .from('household_members')
    .select('rotation_order')
    .eq('household_id', householdId)
    .order('rotation_order', { ascending: false })
    .limit(1);
}

export async function deleteMember(householdId, userId) {
  return db
    .from('household_members')
    .delete()
    .eq('household_id', householdId)
    .eq('user_id', userId);
}
