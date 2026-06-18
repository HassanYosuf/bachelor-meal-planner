import { db } from '../../core/supabase.js';

export async function fetchIngredients() {
  return db.from('ingredients').select('*').order('category').order('name');
}

export async function fetchMealIngredients() {
  return db
    .from('meal_ingredients')
    .select('meal_id, ingredient_id, is_key, ingredients(name)');
}

export async function fetchPantryItems(userId) {
  return db
    .from('pantry_items')
    .select('id, ingredient_id, added_at')
    .eq('user_id', userId)
    .order('added_at');
}

export async function addPantryItem(userId, ingredientId) {
  return db
    .from('pantry_items')
    .upsert({ user_id: userId, ingredient_id: ingredientId }, { onConflict: 'user_id,ingredient_id' })
    .select()
    .single();
}

export async function removePantryItem(userId, ingredientId) {
  return db
    .from('pantry_items')
    .delete()
    .eq('user_id', userId)
    .eq('ingredient_id', ingredientId);
}

export async function clearPantry(userId) {
  return db.from('pantry_items').delete().eq('user_id', userId);
}
