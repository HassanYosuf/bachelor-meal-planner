import { db } from '../../core/supabase.js';

export async function fetchMeals() {
  return db.from('meals').select('*').order('category').order('name');
}

export async function fetchTodayLog(userId, dateStr) {
  return db
    .from('meal_logs')
    .select('*')
    .eq('log_date', dateStr)
    .eq('user_id', userId)
    .order('logged_at');
}

export async function insertMealLog(entry) {
  return db.from('meal_logs').insert(entry).select().single();
}

export async function deleteMealLog(id) {
  return db.from('meal_logs').delete().eq('id', id);
}

export async function deleteMealLogs(ids) {
  return db.from('meal_logs').delete().in('id', ids);
}

export async function upsertDailySummary(summary) {
  return db.from('daily_summaries').upsert(summary, { onConflict: 'log_date,user_id' });
}

export async function fetchDailySummaries(userId) {
  return db
    .from('daily_summaries')
    .select('*')
    .eq('user_id', userId)
    .order('log_date', { ascending: false })
    .limit(30);
}

export async function fetchMealLogsByDate(userId, dateStr) {
  return db
    .from('meal_logs')
    .select('meal_name')
    .eq('log_date', dateStr)
    .eq('user_id', userId);
}

export async function fetchStreakData(userId) {
  return db
    .from('daily_summaries')
    .select('log_date, total_meals')
    .eq('user_id', userId)
    .order('log_date', { ascending: false })
    .limit(60);
}
