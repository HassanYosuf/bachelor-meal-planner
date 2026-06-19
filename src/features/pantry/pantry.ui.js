import { state } from '../../core/state.js';
import { showToast } from '../../utils/toast.js';
import { insertMealLog, upsertDailySummary, fetchTodayLog } from '../meals/meals.service.js';
import {
  fetchIngredients, fetchMealIngredients, fetchPantryItems,
  addPantryItem, removePantryItem, clearPantry, fetchRecentMealHistory,
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

// ── Voice capture ──────────────────────────────────────────────────────────

let _recognition = null;

function matchIngredientByText(text) {
  const q = text.toLowerCase().trim();
  if (!q) return null;
  // Exact name match
  const exact = state.pantryIngredients.find(i => i.name.toLowerCase() === q);
  if (exact) return exact;
  // Starts-with match
  const starts = state.pantryIngredients.find(i => i.name.toLowerCase().startsWith(q) || q.startsWith(i.name.toLowerCase()));
  if (starts) return starts;
  // Partial containment
  const partial = state.pantryIngredients.find(i => i.name.toLowerCase().includes(q) || q.includes(i.name.toLowerCase()));
  return partial || null;
}

function parseVoiceTokens(transcript) {
  return transcript
    .toLowerCase()
    .replace(/\band\b/g, ',')
    .replace(/\bwith\b/g, ',')
    .replace(/\balso\b/g, ',')
    .split(/[,،،]+/)
    .map(t => t.trim())
    .filter(t => t.length > 1);
}

export async function startVoiceCapture() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    showToast('Voice input not supported in this browser');
    return;
  }

  if (state.voiceActive) {
    stopVoiceCapture();
    return;
  }

  _recognition = new SR();
  _recognition.lang = 'en-US';
  _recognition.interimResults = true;
  _recognition.maxAlternatives = 1;
  _recognition.continuous = false;

  state.voiceActive = true;
  updateVoiceUI(true, '');

  _recognition.onresult = (e) => {
    const interim = Array.from(e.results).map(r => r[0].transcript).join(' ');
    updateVoiceUI(true, interim);

    if (e.results[e.results.length - 1].isFinal) {
      const finalText = e.results[e.results.length - 1][0].transcript;
      processVoiceTranscript(finalText);
    }
  };

  _recognition.onerror = (e) => {
    if (e.error !== 'no-speech') showToast('Voice error: ' + e.error);
    stopVoiceCapture();
  };

  _recognition.onend = () => {
    stopVoiceCapture();
  };

  _recognition.start();
}

export function stopVoiceCapture() {
  state.voiceActive = false;
  if (_recognition) {
    try { _recognition.stop(); } catch (_) {}
    _recognition = null;
  }
  updateVoiceUI(false, '');
}

function updateVoiceUI(active, interimText) {
  const btn = document.getElementById('pantry-mic-btn');
  if (btn) btn.classList.toggle('listening', active);

  let overlay = document.getElementById('voice-overlay');
  if (active) {
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'voice-overlay';
      overlay.className = 'voice-overlay';
      overlay.innerHTML = `
        <div class="voice-pill">
          <span class="voice-dot"></span>
          <span id="voice-interim">Listening…</span>
          <button class="voice-stop-btn" onclick="stopVoiceCapture()">Stop</button>
        </div>`;
      document.getElementById('view-pantry').prepend(overlay);
    }
    const el = document.getElementById('voice-interim');
    if (el) el.textContent = interimText || 'Listening…';
  } else {
    if (overlay) overlay.remove();
  }
}

async function processVoiceTranscript(transcript) {
  const tokens = parseVoiceTokens(transcript);
  if (!tokens.length) { showToast('Didn\'t catch any ingredients'); return; }

  let added = 0;

  for (const token of tokens) {
    const match = matchIngredientByText(token);
    if (match) {
      if (!state.pantryItems.includes(match.id)) {
        const { error } = await addPantryItem(state.currentUser.id, match.id);
        if (!error) { state.pantryItems = [...state.pantryItems, match.id]; added++; }
      }
    } else {
      if (!state.customPantryItems.some(i => i.name.toLowerCase() === token.toLowerCase())) {
        state.customPantryItems = [...state.customPantryItems, { name: token, category: guessCategory(token) }];
        added++;
      }
    }
  }

  saveCustomItems();
  renderPantry();
  showToast(added > 0 ? `Added ${added} ingredient${added > 1 ? 's' : ''} ✓` : 'Already in pantry');
}

// ── Shopping cart ───────────────────────────────────────────────────────────

export function addMissingToCart(mealId) {
  const entry = scoreMeals().find(s => s.meal.id === mealId);
  if (!entry || !entry.missing.length) return;

  let added = 0;
  for (const m of entry.missing) {
    if (!state.shoppingCart.some(c => c.ingredientId === m.id)) {
      state.shoppingCart.push({ name: m.name, ingredientId: m.id });
      added++;
    }
  }
  if (added) { showToast(`${added} item${added > 1 ? 's' : ''} added to cart`); }
  else        { showToast('Already in cart'); }
  syncCartBadge();
}

export function removeFromCart(ingredientId) {
  state.shoppingCart = state.shoppingCart.filter(c => c.ingredientId !== ingredientId);
  syncCartBadge();
  const body = document.getElementById('cart-drawer-body');
  if (body) body.innerHTML = buildCartBody();
}

export function clearCart() {
  state.shoppingCart = [];
  syncCartBadge();
  const body = document.getElementById('cart-drawer-body');
  if (body) body.innerHTML = buildCartBody();
}

export function openCartDrawer() {
  let drawer = document.getElementById('cart-drawer');
  if (!drawer) {
    drawer = document.createElement('div');
    drawer.id = 'cart-drawer';
    drawer.className = 'cart-drawer';
    document.body.appendChild(drawer);
  }
  drawer.innerHTML = `
    <div class="cart-drawer-header">
      <h3 class="cart-drawer-title">🛒 Shopping List</h3>
      <button class="cart-drawer-close" onclick="closeCartDrawer()">×</button>
    </div>
    <div id="cart-drawer-body">${buildCartBody()}</div>`;
  drawer.classList.add('open');

  let backdrop = document.getElementById('cart-backdrop');
  if (!backdrop) {
    backdrop = document.createElement('div');
    backdrop.id = 'cart-backdrop';
    backdrop.className = 'cart-backdrop';
    backdrop.onclick = closeCartDrawer;
    document.body.appendChild(backdrop);
  }
  backdrop.classList.add('open');
}

export function closeCartDrawer() {
  document.getElementById('cart-drawer')?.classList.remove('open');
  document.getElementById('cart-backdrop')?.classList.remove('open');
}

function buildCartBody() {
  if (!state.shoppingCart.length) {
    return '<p class="cart-empty">No items yet. Tap "Add missing" on an almost-ready meal.</p>';
  }
  const items = state.shoppingCart.map(c => `
    <div class="cart-item">
      <span class="cart-item-name">${escHtml(c.name)}</span>
      <div class="cart-item-actions">
        <button class="cart-amazon-btn" onclick="orderOnAmazon('${escHtml(c.name)}')">Amazon</button>
        <button class="cart-remove-btn" onclick="removeFromCart('${escHtml(c.ingredientId)}')">×</button>
      </div>
    </div>`).join('');
  return `
    ${items}
    <div class="cart-footer">
      <button class="cart-order-all-btn" onclick="orderAllOnAmazon()">Order All on Amazon</button>
      <button class="cart-clear-btn" onclick="clearCart()">Clear list</button>
    </div>`;
}

export function orderOnAmazon(name) {
  window.open(`https://www.amazon.com/s?k=${encodeURIComponent(name)}`, '_blank', 'noopener');
}

export function orderAllOnAmazon() {
  for (const item of state.shoppingCart) {
    window.open(`https://www.amazon.com/s?k=${encodeURIComponent(item.name)}`, '_blank', 'noopener');
  }
}

function syncCartBadge() {
  const badge = document.getElementById('cart-badge');
  if (badge) {
    badge.textContent = state.shoppingCart.length;
    badge.style.display = state.shoppingCart.length ? 'flex' : 'none';
  }
}

// ── Load ───────────────────────────────────────────────────────────────────

// ── Staples pre-check ──────────────────────────────────────────────────────

const STAPLES = [
  { name: 'salt',       category: 'condiment' },
  { name: 'oil',        category: 'condiment' },
  { name: 'onion',      category: 'vegetable' },
  { name: 'garlic',     category: 'vegetable' },
  { name: 'ginger',     category: 'condiment' },
  { name: 'turmeric',   category: 'condiment' },
  { name: 'cumin',      category: 'condiment' },
  { name: 'coriander',  category: 'condiment' },
];

function staplesKey() { return `pantry_staples_checked_${state.currentUser.id}`; }

function checkFirstPantryVisit() {
  if (localStorage.getItem(staplesKey())) return;
  showStaplesModal();
}

function showStaplesModal() {
  if (document.getElementById('staples-modal')) return;

  const backdrop = document.createElement('div');
  backdrop.id = 'staples-backdrop';
  backdrop.className = 'staples-backdrop';
  document.body.appendChild(backdrop);

  const modal = document.createElement('div');
  modal.id = 'staples-modal';
  modal.className = 'staples-modal';
  modal.innerHTML = `
    <div class="staples-icon">🧂</div>
    <h3 class="staples-title">What's always in your kitchen?</h3>
    <p class="staples-sub">We'll assume you always have these basics — so your suggestions make sense right away.</p>
    <div class="staples-chips">
      ${STAPLES.map(s => `
        <button class="staples-chip active" data-name="${escHtml(s.name)}" data-cat="${s.category}" onclick="toggleStapleChip(this)">
          ${s.name}
        </button>`).join('')}
    </div>
    <div class="staples-actions">
      <button class="staples-confirm-btn" onclick="confirmStaples()">Yes, add these</button>
      <button class="staples-skip-btn" onclick="dismissStaplesModal()">Skip</button>
    </div>`;
  document.body.appendChild(modal);
}

export function toggleStapleChip(btn) {
  btn.classList.toggle('active');
}

export function confirmStaples() {
  const chips = document.querySelectorAll('.staples-chip.active');
  chips.forEach(chip => {
    const name = chip.dataset.name;
    const category = chip.dataset.cat;
    if (!state.customPantryItems.some(i => i.name.toLowerCase() === name.toLowerCase())) {
      state.customPantryItems = [...state.customPantryItems, { name, category }];
    }
  });
  saveCustomItems();
  localStorage.setItem(staplesKey(), '1');
  document.getElementById('staples-modal')?.remove();
  document.getElementById('staples-backdrop')?.remove();
  renderPantry();
  showToast(`${chips.length} staples added to your pantry ✓`);
}

export function dismissStaplesModal() {
  localStorage.setItem(staplesKey(), '1');
  document.getElementById('staples-modal')?.remove();
  document.getElementById('staples-backdrop')?.remove();
}

// ── Repeat preference ──────────────────────────────────────────────────────

function repeatKey() { return `pantry_repeat_days_${state.currentUser.id}`; }

function loadRepeatPref() {
  const stored = parseInt(localStorage.getItem(repeatKey()), 10);
  state.mealRepeatDays = isNaN(stored) ? 7 : stored;
}

function saveRepeatPref() {
  localStorage.setItem(repeatKey(), String(state.mealRepeatDays));
}

async function refreshMealHistory() {
  if (!state.mealRepeatDays) { state.recentMealHistory = []; return; }
  const { data } = await fetchRecentMealHistory(state.currentUser.id, 14);
  const today = new Date();
  state.recentMealHistory = (data || []).map(r => {
    const d    = new Date(r.log_date + 'T00:00:00');
    const diff = Math.round((today - d) / 86400000);
    return { meal_id: r.meal_id, meal_name: r.meal_name, log_date: r.log_date, daysAgo: diff };
  });
}

export async function loadPantryView() {
  document.getElementById('view-pantry').innerHTML = '<p class="pantry-loading">Loading pantry…</p>';

  loadRepeatPref();

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

  await refreshMealHistory();
  renderPantry();
  checkFirstPantryVisit();
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
          <div class="pantry-header-actions">
            <button class="pantry-mic-btn${state.voiceActive ? ' listening' : ''}" id="pantry-mic-btn" onclick="startVoiceCapture()" title="Speak your ingredients">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                <path d="M19 10v2a7 7 0 0 1-14 0v-2H3v2a9 9 0 0 0 8 8.94V23h2v-2.06A9 9 0 0 0 21 12v-2h-2z"/>
              </svg>
            </button>
            <button class="pantry-cart-btn" id="pantry-cart-btn" onclick="openCartDrawer()" title="Shopping list">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/>
                <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>
              </svg>
              <span class="cart-badge" id="cart-badge" style="display:${state.shoppingCart.length ? 'flex' : 'none'}">${state.shoppingCart.length}</span>
            </button>
            <button class="pantry-clear-btn" id="pantry-clear-btn" onclick="clearAllPantry()" ${!hasAnything ? 'disabled' : ''}>
              Clear all
            </button>
          </div>
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
        <div id="pantry-active-chips">${buildActiveChips()}</div>
        <div id="pantry-list-toggle">${buildListToggle()}</div>
        <div id="pantry-categories" class="pantry-categories-collapsible${state.pantryListOpen || state.pantrySearch ? ' open' : ''}">${buildCategories()}</div>
      </section>

      <section class="section pantry-suggest-section">
        <h2 class="section-title" style="margin-bottom:6px">🍳 What You Can Cook</h2>
        <div id="pantry-repeat-settings">${buildRepeatSettings()}</div>
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
  if (el('pantry-custom-add-area')) el('pantry-custom-add-area').innerHTML = buildCustomAddArea();
  if (el('pantry-active-chips'))  el('pantry-active-chips').innerHTML  = buildActiveChips();
  if (el('pantry-list-toggle'))   el('pantry-list-toggle').innerHTML   = buildListToggle();
  if (el('pantry-categories')) {
    el('pantry-categories').innerHTML = buildCategories();
    el('pantry-categories').classList.toggle('open', !!(state.pantryListOpen || state.pantrySearch));
  }
  if (el('pantry-repeat-settings')) el('pantry-repeat-settings').innerHTML = buildRepeatSettings();
  if (el('pantry-filter-tabs'))   el('pantry-filter-tabs').innerHTML   = buildFilterTabs(suggestions, readyCount, almostCount);
  if (el('pantry-suggest-body'))  el('pantry-suggest-body').innerHTML  = buildSuggestBody(suggestions);
  syncClearBtn();
}

// ── Build helpers ──────────────────────────────────────────────────────────

function buildActiveChips() {
  const predefined = state.pantryIngredients
    .filter(i => state.pantryItems.includes(i.id));
  const custom = state.customPantryItems;
  const all = [
    ...predefined.map(i => ({ name: i.name, icon: i.icon || CATEGORY_ICONS[i.category] || '✦', isCustom: false, id: i.id })),
    ...custom.map(i => ({ name: i.name, icon: CATEGORY_ICONS[i.category] || '✦', isCustom: true })),
  ];

  if (!all.length) {
    return `<p class="pantry-active-empty">Use the mic or search to add ingredients.</p>`;
  }

  return `
    <div class="pantry-active-label">In your pantry</div>
    <div class="pantry-active-chips">
      ${all.map(i => i.isCustom
        ? `<button class="pantry-chip active" onclick="removeCustomPantryItem('${escHtml(i.name)}')" title="Remove">${i.icon} ${escHtml(i.name)} <span class="chip-x">×</span></button>`
        : `<button class="pantry-chip active" onclick="togglePantryItem('${i.id}')" title="Remove">${i.icon} ${escHtml(i.name)} <span class="chip-x">×</span></button>`
      ).join('')}
    </div>`;
}

function buildListToggle() {
  if (state.pantrySearch) return '';
  const label = state.pantryListOpen ? 'Hide ingredient list' : 'Browse ingredients';
  const arrow  = state.pantryListOpen ? '▴' : '▾';
  return `<button class="pantry-list-toggle" onclick="toggleIngredientList()">${label} ${arrow}</button>`;
}

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
  const recentCount = state.recentMealHistory.length
    ? [...new Set(state.recentMealHistory
        .filter(r => !state.mealRepeatDays || r.daysAgo <= state.mealRepeatDays)
        .map(r => r.meal_id))].length
    : 0;

  return `
    <button class="pantry-filter-tab${state.pantryFilter === 'all'    ? ' active' : ''}" onclick="setPantryFilter('all')">All (${suggestions.length})</button>
    <button class="pantry-filter-tab${state.pantryFilter === 'ready'  ? ' active' : ''}" onclick="setPantryFilter('ready')">✅ Ready (${readyCount})</button>
    <button class="pantry-filter-tab${state.pantryFilter === 'almost' ? ' active' : ''}" onclick="setPantryFilter('almost')">🟡 Almost (${almostCount})</button>
    ${recentCount ? `<button class="pantry-filter-tab${state.pantryFilter === 'recent' ? ' active' : ''}" onclick="setPantryFilter('recent')">🔁 Recent</button>` : ''}`;
}

function buildRepeatSettings() {
  const opts = [
    { label: '3d', value: 3 },
    { label: '7d', value: 7 },
    { label: '14d', value: 14 },
    { label: 'Off', value: 0 },
  ];
  return `
    <div class="repeat-settings">
      <span class="repeat-label">Avoid repeats for</span>
      ${opts.map(o => `
        <button
          class="repeat-opt${state.mealRepeatDays === o.value ? ' active' : ''}"
          onclick="setRepeatDays(${o.value})"
        >${o.label}</button>`).join('')}
    </div>`;
}

function buildSuggestBody(suggestions) {
  // "Recent" tab: show a timeline of what was eaten in the window
  if (state.pantryFilter === 'recent') {
    const window = state.mealRepeatDays;
    const items = window
      ? state.recentMealHistory.filter(r => r.daysAgo <= window)
      : state.recentMealHistory;
    if (!items.length) return '<p class="pantry-empty-hint">No meals logged in this period.</p>';

    const seen = new Set();
    const deduped = items.filter(r => {
      if (seen.has(r.meal_id)) return false;
      seen.add(r.meal_id);
      return true;
    });

    return `
      <div class="repeat-history-list">
        ${deduped.map(r => `
          <div class="repeat-history-item">
            <span class="repeat-history-name">${escHtml(r.meal_name)}</span>
            <span class="repeat-history-days">${r.daysAgo === 0 ? 'today' : r.daysAgo === 1 ? 'yesterday' : `${r.daysAgo}d ago`}</span>
          </div>`).join('')}
      </div>
      <p class="repeat-history-hint">These meals will be deprioritised in suggestions.</p>`;
  }

  let list = suggestions;
  if (state.pantryFilter === 'ready')  list = suggestions.filter(s => s.score === 100);
  if (state.pantryFilter === 'almost') list = suggestions.filter(s => s.score >= 50 && s.score < 100);

  if (!state.pantryItems.length && !state.customPantryItems.length)
    return '<p class="pantry-empty-hint">Add ingredients above to see meal suggestions.</p>';
  if (!list.length)
    return '<p class="pantry-empty-hint">No meals match this filter with your current pantry.</p>';

  return list.map(({ meal, score, missing, isCustomSuggestion, recentlyEaten, daysAgo }) => {
    const badgeClass  = score === 100 ? 'badge-ready' : score >= 75 ? 'badge-close' : 'badge-partial';
    const missingText = missing.length
      ? `<div class="suggest-missing">Missing: ${missing.map(m => m.name).join(', ')}</div>`
      : '';
    const repeatBadge = recentlyEaten
      ? `<div class="suggest-repeat-badge">🔁 ${daysAgo === 0 ? 'today' : daysAgo === 1 ? 'yesterday' : `${daysAgo}d ago`}</div>`
      : '';
    const calText = meal.cal_estimate != null ? `~${meal.cal_estimate} kcal · ` : '';
    const cartBtn = (!isCustomSuggestion && missing.length)
      ? `<button class="suggest-btn suggest-cart-btn" onclick="addMissingToCart('${meal.id}')">🛒 Add missing</button>`
      : '';
    const actions = isCustomSuggestion
      ? `<button class="suggest-btn suggest-log-btn" onclick="pantryLogToday('${meal.id}')">+ Log Today</button>`
      : `<button class="suggest-btn suggest-log-btn"  onclick="pantryLogToday('${meal.id}')">+ Log Today</button>
         <button class="suggest-btn suggest-week-btn" onclick="pantryAddToWeek('${meal.id}', '${meal.meal_type}')">+ Week Plan</button>
         ${cartBtn}`;
    return `
      <div class="suggest-card${recentlyEaten ? ' suggest-card-muted' : ''}">
        <div class="suggest-top">
          <div class="suggest-meal-info">
            <span class="suggest-icon">${meal.icon || '🍽'}</span>
            <div>
              <div class="suggest-name">${meal.name}</div>
              <div class="suggest-meta">${calText}${meal.category}</div>
              ${missingText}
              ${repeatBadge}
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
      const histEntry = state.recentMealHistory.find(r => r.meal_id === meal.id);
      const recentlyEaten = histEntry && state.mealRepeatDays && histEntry.daysAgo <= state.mealRepeatDays;
      const daysAgo = histEntry ? histEntry.daysAgo : null;
      return { meal, score, missing, recentlyEaten: !!recentlyEaten, daysAgo };
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

  return [...directSuggestions, ...scored].sort((a, b) => {
    // primary: score descending; secondary: recently eaten sinks lower
    if (b.score !== a.score) return b.score - a.score;
    return (a.recentlyEaten ? 1 : 0) - (b.recentlyEaten ? 1 : 0);
  });
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

export async function setRepeatDays(days) {
  state.mealRepeatDays = days;
  saveRepeatPref();
  await refreshMealHistory();
  partialUpdate();
}

export function toggleIngredientList() {
  state.pantryListOpen = !state.pantryListOpen;
  const el = document.getElementById('pantry-categories');
  if (el) el.classList.toggle('open', state.pantryListOpen);
  const tog = document.getElementById('pantry-list-toggle');
  if (tog) tog.innerHTML = buildListToggle();
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
