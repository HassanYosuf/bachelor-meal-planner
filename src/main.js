import { initApp, switchView } from './core/router.js';
import { setTheme } from './utils/theme.js';
import { toggleDropdown } from './utils/dropdown.js';
import { toggleUserMenu, signOut, openProfileDrawer, closeProfileDrawer,
  triggerAvatarUpload, handleAvatarChange, saveProfile, sendPasswordReset,
  submitAuth, switchAuthTab, showAuthState, submitForgotPassword,
  submitNewPassword, openDeleteModal, closeDeleteModal, deleteAccount } from './features/auth/auth.ui.js';
import { removeMeal } from './features/meals/meals.ui.js';
import { shiftWeek, selectWeekDay, openWeekModal, closeWeekModal,
  confirmAddToWeek, removeFromWeekPlan } from './features/week-plan/weekPlan.ui.js';
import { createHousehold, joinHousehold, leaveHousehold,
  copyCode } from './features/household/household.ui.js';
import { openSuggestModal, closeSuggestModal, confirmSuggestMeal,
  submitVote, openResolveModal, closeResolveModal,
  resolveTie } from './features/collaborative/collaborative.ui.js';

// Expose functions used in inline HTML event handlers (onclick="...")
Object.assign(window, {
  switchView,
  setTheme,
  toggleDropdown,
  toggleUserMenu,
  signOut,
  openProfileDrawer,
  closeProfileDrawer,
  triggerAvatarUpload,
  handleAvatarChange,
  saveProfile,
  sendPasswordReset,
  submitAuth,
  switchAuthTab,
  showAuthState,
  submitForgotPassword,
  submitNewPassword,
  openDeleteModal,
  closeDeleteModal,
  deleteAccount,
  removeMeal,
  shiftWeek,
  selectWeekDay,
  openWeekModal,
  closeWeekModal,
  confirmAddToWeek,
  removeFromWeekPlan,
  createHousehold,
  joinHousehold,
  leaveHousehold,
  copyCode,
  openSuggestModal,
  closeSuggestModal,
  confirmSuggestMeal,
  submitVote,
  openResolveModal,
  closeResolveModal,
  resolveTie,
});

initApp();
