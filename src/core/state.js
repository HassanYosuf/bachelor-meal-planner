import { getMonday, todayDayOfWeek } from '../utils/date.js';

const _today = new Date();

export const state = {
  /* auth */
  currentUser: null,
  authMode: 'signin',
  inPasswordRecovery: false,

  /* navigation */
  currentView: 'today',

  /* meals / today */
  allMeals: [],
  loggedMeals: [],
  selectedType: 'breakfast',
  soakTimer: null,
  soakRemaining: 0,
  currentPrepMeal: null,
  today: _today,
  todayStr: _today.toISOString().split('T')[0],

  /* week plan */
  currentWeekStart: getMonday(new Date()),
  selectedWeekDayIdx: todayDayOfWeek(),
  weekPlanData: {},
  weekModalTarget: null,

  /* household */
  householdData: null,
  householdMembers: [],
  selfMember: null,
  weekPlanChannel: null,

  /* collaborative */
  currentWeekSlots: {},
  slotSuggestions: {},
  slotVotes: {},
  currentDM: null,
  suggestModalTarget: null,
  resolveModalTarget: null,
  collaborativeChannel: null,

  /* pantry */
  pantryIngredients: [],
  mealIngredients: [],
  pantryItems: [],
  customPantryItems: [],   // [{ name, category }]
  pantryFilter: 'all',
  pantrySearch: '',
  pantryPendingCategory: 'vegetable',

  /* ui */
  toastTimer: null,
};
