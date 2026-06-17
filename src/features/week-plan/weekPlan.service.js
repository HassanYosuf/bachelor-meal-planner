import { db } from '../../core/supabase.js';

export async function fetchWeekPlanData(weekStart, userIds) {
  return db
    .from('week_plans')
    .select('*')
    .eq('week_start', weekStart)
    .in('user_id', userIds);
}

export async function upsertWeekPlan(entry) {
  return db
    .from('week_plans')
    .upsert(entry, { onConflict: 'user_id,week_start,day_of_week,meal_type' })
    .select()
    .single();
}

export async function deleteWeekPlan(id) {
  return db.from('week_plans').delete().eq('id', id);
}
