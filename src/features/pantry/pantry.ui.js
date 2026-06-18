import { state } from '../../core/state.js';
import { showToast } from '../../utils/toast.js';
import { insertMealLog, upsertDailySummary, fetchTodayLog } from '../meals/meals.service.js';
import {
  fetchIngredients, fetchMealIngredients, fetchPantryItems,
  addPantryItem, removePantryItem, clearPantry,
} from './pantry.service.js';

// ── Constants ──────────────────────────────────────────────────────────────

const CATEGORY_LABELS = {
  protein:   '🥩 Protein',
  carb:      '🌾 Carbs',
  vegetable: '🥦 Vegetables',
  dairy:     '🥛 Dairy',
  condiment: '🫙 Condiments',
  fruit:     '🍎 Fruits',
  snack:     '🍪 Snacks',
  beverage:  '🫖 Beverages',
};

const CATEGORY_ICONS = {
  protein: '🥩', carb: '🌾', vegetable: '🥦', dairy: '🥛',
  condiment: '🫙', fruit: '🍎', snack: '🍪', beverage: '🫖',
};

// Keyword → category map for auto-classification
const KEYWORD_MAP = {
  // protein
  egg: 'protein', chicken: 'protein', beef: 'protein', mutton: 'protein', lamb: 'protein',
  pork: 'protein', fish: 'protein', tuna: 'protein', salmon: 'protein', shrimp: 'protein',
  prawn: 'protein', tofu: 'protein', soya: 'protein', dal: 'protein', lentil: 'protein',
  bean: 'protein', rajma: 'protein', chole: 'protein', chickpea: 'protein', moong: 'protein',
  chana: 'protein', paneer: 'protein', tempeh: 'protein',
  // carb
  rice: 'carb', bread: 'carb', pasta: 'carb', flour: 'carb', atta: 'carb', maida: 'carb',
  noodle: 'carb', oat: 'carb', semolina: 'carb', suji: 'carb', poha: 'carb', roti: 'carb',
  chapati: 'carb', pav: 'carb', bun: 'carb', tortilla: 'carb', quinoa: 'carb',
  barley: 'carb', couscous: 'carb', vermicelli: 'carb', macaroni: 'carb',
  // vegetable
  onion: 'vegetable', tomato: 'vegetable', potato: 'vegetable', garlic: 'vegetable',
  ginger: 'vegetable', spinach: 'vegetable', carrot: 'vegetable', pea: 'vegetable',
  corn: 'vegetable', cauliflower: 'vegetable', broccoli: 'vegetable', cabbage: 'vegetable',
  capsicum: 'vegetable', pepper: 'vegetable', mushroom: 'vegetable', cucumber: 'vegetable',
  lady: 'vegetable', okra: 'vegetable', aloo: 'vegetable', palak: 'vegetable',
  zucchini: 'vegetable', eggplant: 'vegetable', beetroot: 'vegetable', radish: 'vegetable',
  // dairy
  milk: 'dairy', curd: 'dairy', yogurt: 'dairy', cheese: 'dairy', butter: 'dairy',
  ghee: 'dairy', cream: 'dairy', whey: 'dairy',
  // condiment
  oil: 'condiment', salt: 'condiment', sugar: 'condiment', honey: 'condiment',
  masala: 'condiment', sauce: 'condiment', vinegar: 'condiment', soy: 'condiment',
  ketchup: 'condiment', mayo: 'condiment', mustard: 'condiment', chilli: 'condiment',
  cumin: 'condiment', turmeric: 'condiment', coriander: 'condiment', cardamom: 'condiment',
  cinnamon: 'condiment', clove: 'condiment', oregano: 'condiment', basil: 'condiment',
  thyme: 'condiment', tamarind: 'condiment', kokum: 'condiment',
  // fruit
  banana: 'fruit', apple: 'fruit', mango: 'fruit', orange: 'fruit', lemon: 'fruit',
  lime: 'fruit', grape: 'fruit', strawberry: 'fruit', watermelon: 'fruit', papaya: 'fruit',
  pomegranate: 'fruit', pineapple: 'fruit', guava: 'fruit', coconut: 'fruit',
  // snack
  biscuit: 'snack', cookie: 'snack', chips: 'snack', nut: 'snack', peanut: 'snack',
  cashew: 'snack', almond: 'snack', popcorn: 'snack', granola: 'snack', rusk: 'snack',
  // beverage
  tea: 'beverage', chai: 'beverage', coffee: 'beverage', juice: 'beverage',
};

function guessCategory(text) {
  const words = text.toLowerCase().split(/\s+/);
  for (const word of words) {
    if (KEYWORD_MAP[word]) return KEYWORD_MAP[word];
    // partial match
    for (const [key, cat] of Object.entries(KEYWORD_MAP)) {
      if (word.includes(key) || key.includes(word)) return cat;
    }
  }
  return 'condiment'; // sensible fallback
}

// ── localStorage helpers ───────────────────────────────────────────────────

function customKey() { return `pantry_custom_${state.currentUser.id}`; }

function loadCustomItems() {
  try {
    const raw = JSON.parse(localStorage.getItem(customKey()) || '[]');
    // Migrate old string-only format
    return raw.map(item =>
      typeof item === 'string'
        ? { name: item, category: guessCategory(item) }
        : item
    );
  } catch { return []; }
}

function saveCustomItems() {
  localStorage.setItem(customKey(), JSON.stringify(state.customPantryItems));
}

// ── Load ───────────────────────────────────────────────────────────────────

export async function loadPantryView() {
  document.getElementById('view-pantry').innerHTML = '<p class="pantry-loading">Loading pantry…</p>';

  const [ingRes, miRes, piRes] = await Promise.all([
    fetchIngredients(),
    fetchMealIngredients(),
    fetchPantryItems(state.currentUser.id),
  ]);

  if (ingRes.error || miRes.error) { showToast('Could not load pantry data'); return; }

  state.pantryIngredients = ingRes.data || [];
  state.mealIngredients   = (miRes.data || []).map(mi => ({
    meal_id: mi.meal_id, ingredient_id: mi.ingredient_id, is_key: mi.is_key,
  }));
  state.pantryItems        = (piRes.data || []).map(p => p.ingredient_id);
  state.customPantryItems  = loadCustomItems();
  state.pantrySearch       = '';

  renderPantry();
}

// ── Full render ────────────────────────────────────────────────────────────

function renderPantry() {
  const suggestions = scoreMeals();
  const readyCount  = suggestions.filter(s => s.score === 100).length;
  const almostCount = suggestions.filter(s => s.score >= 50 && s.score < 100).length;
  const hasAnything = state.pantryItems.length > 0 || state.customPantryItems.length > 0;

  document.getElementById('view-pantry').innerHTML = `
    <div class="pantry-wrap">
      <section class="section pantry-section">
        <div class="pantry-header">
          <h2 class="section-title">🥬 My Pantry</h2>
          <button class="pantry-clear-btn" id="pantry-clear-btn" onclick="clearAllPantry()" ${!hasAnything ? 'disabled' : ''}>
            Clear all
          </button>
        </div>

        <div class="pantry-search-wrap">
          <svg class="pantry-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            class="pantry-search-input"
            id="pantry-search-input"
            type="text"
            placeholder="Search or type an ingredient…"
            value="${escHtml(state.pantrySearch)}"
            oninput="setPantrySearch(this.value)"
            onkeydown="pantrySearchKeydown(event)"
            autocomplete="off"
            autocapitalize="none"
            spellcheck="false"
          />
          ${state.pantrySearch
            ? `<button class="pantry-search-clear" onclick="setPantrySearch('')" aria-label="Clear">×</button>`
            : ''}
        </div>

        <div id="pantry-custom-add-area">${buildCustomAddArea()}</div>
        <div id="pantry-categories">${buildCategories()}</div>
      </section>

      <section class="section pantry-suggest-section">
        <h2 class="section-title" style="margin-bottom:10px">🍳 What You Can Cook</h2>
        <div class="pantry-filter-tabs" id="pantry-filter-tabs">
          ${buildFilterTabs(suggestions, readyCount, almostCount)}
        </div>
        <div id="pantry-suggest-body">${buildSuggestBody(suggestions)}</div>
      </section>
    </div>`;
}

// ── Partial update (no input re-render → keyboard stays open) ─────────────

function partialUpdate() {
  const suggestions = scoreMeals();
  const readyCount  = suggestions.filter(s => s.score === 100).length;
  const almostCount = suggestions.filter(s => s.score >= 50 && s.score < 100).length;

  const el = id => document.getElementById(id);
  if (el('pantry-categories'))    el('pantry-categories').innerHTML    = buildCategories();
  if (el('pantry-custom-add-area')) el('pantry-custom-add-area').innerHTML = buildCustomAddArea();
  if (el('pantry-suggest-body'))  el('pantry-suggest-body').innerHTML  = buildSuggestBody(suggestions);
  if (el('pantry-filter-tabs'))   el('pantry-filter-tabs').innerHTML   = buildFilterTabs(suggestions, readyCount, almostCount);
  syncClearBtn();
}

// ── Build helpers ──────────────────────────────────────────────────────────

function buildCategories() {
  const search  = state.pantrySearch.toLowerCase().trim();

  // Clone category groups from predefined ingredients
  const order   = ['protein', 'carb', 'vegetable', 'dairy', 'condiment', 'fruit', 'snack', 'beverage'];
  const grouped = {};
  for (const ing of state.pantryIngredients) {
    const cat = ing.category || 'other';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push({ ...ing, isCustom: false });
  }

  // Inject custom items into their assigned category group
  for (const item of state.customPantryItems) {
    const cat = item.category || 'condiment';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push({
      id:       `custom:${item.name}`,
      name:     item.name,
      icon:     CATEGORY_ICONS[cat] || '✦',
      isCustom: true,
    });
  }

  // Sort keys: predefined order first, then anything else
  const sortedKeys = [...order.filter(k => grouped[k]), ...Object.keys(grouped).filter(k => !order.includes(k))];

  return sortedKeys.map(cat => {
    const items   = grouped[cat];
    const visible = search ? items.filter(i => i.name.toLowerCase().includes(search)) : items;
    if (!visible.length) return '';

    return `
      <div class="pantry-category">
        <div class="pantry-cat-label">${CATEGORY_LABELS[cat] || cat}</div>
        <div class="pantry-pills">
          ${visible.map(ing => {
            if (ing.isCustom) {
              return `<button class="pantry-pill active custom-pill" title="Custom — tap to remove" onclick="removeCustomPantryItem('${escHtml(ing.name)}')">
                ${ing.icon} ${escHtml(ing.name)} <span class="custom-pill-x">×</span>
              </button>`;
            }
            const have = state.pantryItems.includes(ing.id);
            return `<button class="pantry-pill${have ? ' active' : ''}" onclick="togglePantryItem('${ing.id}')">
              ${ing.icon || ''} ${ing.name}
            </button>`;
          }).join('')}
        </div>
      </div>`;
  }).join('');
}

function buildCustomAddArea() {
  const search = state.pantrySearch.trim();
  if (!search) return '';

  // Exact name match in predefined list → not needed as custom
  const exact = state.pantryIngredients.find(i => i.name.toLowerCase() === search.toLowerCase());
  if (exact) return '';

  // Already added as custom
  if (state.customPantryItems.some(i => i.name.toLowerCase() === search.toLowerCase())) {
    return `<p class="pantry-custom-hint">✓ Already in your pantry</p>`;
  }

  const pending = state.pantryPendingCategory;

  return `
    <div class="pantry-add-card">
      <div class="pantry-add-top">
        <span class="pantry-add-label">Add "<strong>${escHtml(search)}</strong>" as</span>
        <button class="pantry-add-confirm-btn" onclick="confirmCustomPantryItem()">Add</button>
      </div>
      <div class="cat-selector">
        ${Object.entries(CATEGORY_LABELS).map(([cat, label]) => `
          <button
            class="cat-opt${pending === cat ? ' active' : ''}"
            onclick="setPendingCategory('${cat}')"
            title="${label}"
          >${CATEGORY_ICONS[cat]}<span class="cat-opt-label">${label.split(' ').slice(1).join(' ')}</span></button>
        `).join('')}
      </div>
    </div>`;
}

function buildFilterTabs(suggestions, readyCount, almostCount) {
  return `
    <button class="pantry-filter-tab${state.pantryFilter === 'all'    ? ' active' : ''}" onclick="setPantryFilter('all')">All (${suggestions.length})</button>
    <button class="pantry-filter-tab${state.pantryFilter === 'ready'  ? ' active' : ''}" onclick="setPantryFilter('ready')">✅ Ready (${readyCount})</button>
    <button class="pantry-filter-tab${state.pantryFilter === 'almost' ? ' active' : ''}" onclick="setPantryFilter('almost')">🟡 Almost (${almostCount})</button>`;
}

function buildSuggestBody(suggestions) {
  let list = suggestions;
  if (state.pantryFilter === 'ready')  list = suggestions.filter(s => s.score === 100);
  if (state.pantryFilter === 'almost') list = suggestions.filter(s => s.score >= 50 && s.score < 100);

  if (!state.pantryItems.length && !state.customPantryItems.length)
    return '<p class="pantry-empty-hint">Add ingredients above to see meal suggestions.</p>';
  if (!list.length)
    return '<p class="pantry-empty-hint">No meals match this filter with your current pantry.</p>';

  return list.map(({ meal, score, missing, isCustomSuggestion }) => {
    const badgeClass  = score === 100 ? 'badge-ready' : score >= 75 ? 'badge-close' : 'badge-partial';
    const missingText = missing.length
      ? `<div class="suggest-missing">Missing: ${missing.map(m => m.name).join(', ')}</div>`
      : '';
    const calText = meal.cal_estimate != null ? `~${meal.cal_estimate} kcal · ` : '';
    const actions = isCustomSuggestion
      ? `<button class="suggest-btn suggest-log-btn" onclick="pantryLogToday('${meal.id}')">+ Log Today</button>`
      : `<button class="suggest-btn suggest-log-btn"  onclick="pantryLogToday('${meal.id}')">+ Log Today</button>
         <button class="suggest-btn suggest-week-btn" onclick="pantryAddToWeek('${meal.id}', '${meal.meal_type}')">+ Week Plan</button>`;
    return `
      <div class="suggest-card">
        <div class="suggest-top">
          <div class="suggest-meal-info">
            <span class="suggest-icon">${meal.icon || '🍽'}</span>
            <div>
              <div class="suggest-name">${meal.name}</div>
              <div class="suggest-meta">${calText}${meal.category}</div>
              ${missingText}
            </div>
          </div>
          <div class="suggest-score ${badgeClass}">${score}%</div>
        </div>
        <div class="suggest-actions">${actions}</div>
      </div>`;
  }).join('');
}

// ── Scoring ────────────────────────────────────────────────────────────────

const DIRECT_CATEGORIES = ['fruit', 'snack', 'beverage'];

function scoreMeals() {
  if (!state.pantryItems.length && !state.customPantryItems.length) return [];

  // Regular meal scoring against pantry
  const scored = state.allMeals
    .map(meal => {
      const required = state.mealIngredients.filter(mi => mi.meal_id === meal.id && mi.is_key);
      if (!required.length) return null;

      let matchCount = 0;
      const missing  = [];

      for (const mi of required) {
        const ing      = state.pantryIngredients.find(i => i.id === mi.ingredient_id);
        const inPantry = state.pantryItems.includes(mi.ingredient_id);
        const inCustom = ing && state.customPantryItems.some(c =>
          ing.name.toLowerCase().includes(c.name.toLowerCase()) ||
          c.name.toLowerCase().includes(ing.name.toLowerCase())
        );

        if (inPantry || inCustom) {
          matchCount++;
        } else if (ing) {
          missing.push({ id: ing.id, name: ing.name });
        }
      }

      const score = Math.round((matchCount / required.length) * 100);
      return { meal, score, missing };
    })
    .filter(Boolean)
    .filter(r => r.score > 0);

  // Fruit / snack / beverage custom items are ready-to-eat — surface as 100% snack suggestions
  const directSuggestions = state.customPantryItems
    .filter(item => DIRECT_CATEGORIES.includes(item.category))
    .map(item => ({
      meal: {
        id:           `custom:${item.name}`,
        name:         item.name,
        icon:         CATEGORY_ICONS[item.category] || '🍽',
        category:     item.category.charAt(0).toUpperCase() + item.category.slice(1),
        meal_type:    'snack',
        cal_estimate: null,
      },
      score:            100,
      missing:          [],
      isCustomSuggestion: true,
    }));

  return [...directSuggestions, ...scored].sort((a, b) => b.score - a.score);
}

// ── Utilities ──────────────────────────────────────────────────────────────

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function groupByCategory(ingredients) {
  const order = ['protein', 'carb', 'vegetable', 'dairy', 'condiment', 'fruit', 'snack', 'beverage'];
  const map   = {};
  for (const ing of ingredients) {
    const cat = ing.category || 'other';
    if (!map[cat]) map[cat] = [];
    map[cat].push(ing);
  }
  const sorted = {};
  for (const cat of order)           { if (map[cat]) sorted[cat] = map[cat]; }
  for (const cat of Object.keys(map)) { if (!sorted[cat]) sorted[cat] = map[cat]; }
  return sorted;
}

function syncClearBtn() {
  const btn = document.getElementById('pantry-clear-btn');
  if (btn) btn.disabled = !state.pantryItems.length && !state.customPantryItems.length;
}

// ── Exported handlers ──────────────────────────────────────────────────────

export async function togglePantryItem(ingredientId) {
  const had = state.pantryItems.includes(ingredientId);
  if (had) {
    const { error } = await removePantryItem(state.currentUser.id, ingredientId);
    if (error) { showToast('Could not update pantry'); return; }
    state.pantryItems = state.pantryItems.filter(id => id !== ingredientId);
  } else {
    const { error } = await addPantryItem(state.currentUser.id, ingredientId);
    if (error) { showToast('Could not update pantry'); return; }
    state.pantryItems = [...state.pantryItems, ingredientId];
  }
  partialUpdate();
}

export async function clearAllPantry() {
  const { error } = await clearPantry(state.currentUser.id);
  if (error) { showToast('Could not clear pantry'); return; }
  state.pantryItems       = [];
  state.customPantryItems = [];
  state.pantrySearch      = '';
  saveCustomItems();
  renderPantry();
  showToast('Pantry cleared');
}

export function setPantryFilter(filter) {
  state.pantryFilter = filter;
  partialUpdate();
}

export function setPantrySearch(value) {
  state.pantrySearch = value;
  // Auto-guess category for the typed text
  if (value.trim()) state.pantryPendingCategory = guessCategory(value);
  partialUpdate();
  const input = document.getElementById('pantry-search-input');
  if (input && document.activeElement !== input) {
    input.focus();
    try { input.setSelectionRange(value.length, value.length); } catch (_) {}
  }
}

export function pantrySearchKeydown(event) {
  if (event.key !== 'Enter') return;
  const search = state.pantrySearch.trim();
  if (!search) return;

  const exact = state.pantryIngredients.find(i => i.name.toLowerCase() === search.toLowerCase());
  if (exact) {
    togglePantryItem(exact.id);
    state.pantrySearch = '';
    const input = document.getElementById('pantry-search-input');
    if (input) input.value = '';
    partialUpdate();
    return;
  }

  confirmCustomPantryItem();
}

export function setPendingCategory(cat) {
  state.pantryPendingCategory = cat;
  const addArea = document.getElementById('pantry-custom-add-area');
  if (addArea) addArea.innerHTML = buildCustomAddArea();
}

export function confirmCustomPantryItem() {
  const name = state.pantrySearch.trim();
  if (!name) return;
  if (state.customPantryItems.some(i => i.name.toLowerCase() === name.toLowerCase())) return;

  state.customPantryItems = [
    ...state.customPantryItems,
    { name, category: state.pantryPendingCategory },
  ];
  state.pantrySearch = '';
  saveCustomItems();
  renderPantry();
}

export function addCustomPantryItem(text) {
  const name = text.trim();
  if (!name) return;
  if (state.customPantryItems.some(i => i.name.toLowerCase() === name.toLowerCase())) return;

  state.customPantryItems = [
    ...state.customPantryItems,
    { name, category: guessCategory(name) },
  ];
  state.pantrySearch = '';
  saveCustomItems();
  renderPantry();
}

export function removeCustomPantryItem(name) {
  state.customPantryItems = state.customPantryItems.filter(
    i => i.name.toLowerCase() !== name.toLowerCase()
  );
  saveCustomItems();
  renderPantry();
}

// ── Quick actions ──────────────────────────────────────────────────────────

export async function pantryLogToday(mealId) {
  // Custom suggestions have synthetic id like "custom:Water Melon"
  const isCustom = String(mealId).startsWith('custom:');
  let logEntry;

  if (isCustom) {
    const name = mealId.slice('custom:'.length);
    const item = state.customPantryItems.find(i => i.name === name);
    if (!item) return;
    logEntry = {
      log_date: state.todayStr, meal_id: null, meal_name: item.name,
      meal_type: 'snack', cal_estimate: null, user_id: state.currentUser.id,
    };
  } else {
    const meal = state.allMeals.find(m => m.id === mealId);
    if (!meal) return;
    logEntry = {
      log_date: state.todayStr, meal_id: meal.id, meal_name: meal.name,
      meal_type: meal.meal_type, cal_estimate: meal.cal_estimate, user_id: state.currentUser.id,
    };
  }

  const mealName = logEntry.meal_name;
  const { error } = await insertMealLog(logEntry);

  if (error) {
    if (error.code === '23505') { showToast(`${mealName} already logged today`); return; }
    showToast('Could not log meal'); return;
  }

  const { data: refreshed } = await fetchTodayLog(state.currentUser.id, state.todayStr);
  if (refreshed) {
    state.loggedMeals = refreshed;
    await upsertDailySummary({
      log_date: state.todayStr, user_id: state.currentUser.id,
      total_meals: refreshed.length,
      total_cal:   refreshed.reduce((s, m) => s + (m.cal_estimate || 0), 0),
    });
  }
  showToast(`${mealName} logged for today ✓`);
}

export function pantryAddToWeek(mealId, mealType) {
  if (window.switchView) window.switchView('week');
  setTimeout(() => {
    if (window.openWeekModal) window.openWeekModal(state.selectedWeekDayIdx ?? 0, mealType);
  }, 50);
}
