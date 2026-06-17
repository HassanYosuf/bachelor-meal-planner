import { state } from '../../core/state.js';
import { db } from '../../core/supabase.js';
import { showToast } from '../../utils/toast.js';
import { userInitial } from '../../utils/format.js';
import { updateThemeButtons } from '../../utils/theme.js';
import {
  signIn, signUp, resetPasswordForEmail, updatePassword,
  updateUserData, authSignOut, uploadAvatar, getAvatarPublicUrl,
  deleteUserAccount,
} from './auth.service.js';
import { showApp } from '../../core/router.js';

export function showAuthState(authState) {
  ['form', 'confirm', 'forgot', 'reset-sent', 'new-password'].forEach(s => {
    const el = document.getElementById('auth-state-' + s);
    if (el) el.style.display = 'none';
  });
  const target = document.getElementById('auth-state-' + authState);
  if (target) target.style.display = (authState === 'confirm' || authState === 'reset-sent') ? 'flex' : 'block';
  const fl = document.getElementById('forgot-link');
  if (fl) fl.style.display = (authState === 'form' && state.authMode === 'signin') ? 'block' : 'none';
}

export function switchAuthTab(mode) {
  state.authMode = mode;
  document.getElementById('tab-signin').classList.toggle('active', mode === 'signin');
  document.getElementById('tab-signup').classList.toggle('active', mode === 'signup');
  document.getElementById('signup-name-row').style.display = mode === 'signup' ? 'block' : 'none';
  document.getElementById('auth-submit-btn').textContent = mode === 'signin' ? 'Sign in' : 'Create account';
  document.getElementById('auth-error').textContent = '';
  showAuthState('form');
}

export async function submitAuth() {
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  const errEl = document.getElementById('auth-error');
  const btn = document.getElementById('auth-submit-btn');
  errEl.textContent = '';
  errEl.style.color = 'var(--red)';

  if (!email || !password) { errEl.textContent = 'Fill in all fields'; return; }

  btn.disabled = true;
  btn.textContent = '...';

  let result;
  if (state.authMode === 'signin') {
    result = await signIn(email, password);
  } else {
    const name = document.getElementById('auth-name').value.trim();
    result = await signUp(email, password, name);
  }

  btn.disabled = false;
  btn.textContent = state.authMode === 'signin' ? 'Sign in' : 'Create account';

  if (result.error) {
    errEl.textContent = result.error.message;
  } else if (state.authMode === 'signup' && result.data.user && !result.data.session) {
    document.getElementById('auth-confirm-email').textContent = result.data.user.email;
    showAuthState('confirm');
  }
}

export async function submitForgotPassword() {
  const email = document.getElementById('forgot-email').value.trim();
  const errEl = document.getElementById('forgot-error');
  errEl.textContent = '';
  if (!email) { errEl.textContent = 'Enter your email'; return; }

  const { error } = await resetPasswordForEmail(email, window.location.href);

  if (error) { errEl.textContent = error.message; return; }
  document.getElementById('reset-sent-email').textContent = email;
  showAuthState('reset-sent');
}

export async function sendPasswordReset() {
  const { error } = await resetPasswordForEmail(state.currentUser.email, window.location.href);
  showToast(error ? 'Could not send reset email' : 'Password reset link sent to your email');
}

export async function submitNewPassword() {
  const pw = document.getElementById('new-password').value;
  const pw2 = document.getElementById('new-password-confirm').value;
  const errEl = document.getElementById('new-password-error');
  errEl.textContent = '';

  if (!pw || pw.length < 6) { errEl.textContent = 'Password must be at least 6 characters'; return; }
  if (pw !== pw2) { errEl.textContent = 'Passwords do not match'; return; }

  const { error } = await updatePassword(pw);
  if (error) { errEl.textContent = error.message; return; }

  state.inPasswordRecovery = false;
  showToast('Password updated!');
  await showApp();
}

export async function signOut() {
  await authSignOut();
  document.getElementById('user-menu').style.display = 'none';
}

export function toggleUserMenu() {
  const m = document.getElementById('user-menu');
  m.style.display = m.style.display === 'none' ? 'block' : 'none';
}

export function updateAvatarDisplay() {
  const avatarUrl = state.currentUser.user_metadata && state.currentUser.user_metadata.avatar_url;
  const initial = userInitial(state.currentUser);
  const headerBtn = document.getElementById('avatar-btn');
  const menuAvatar = document.getElementById('user-menu-avatar');

  if (avatarUrl) {
    headerBtn.innerHTML = `<img src="${avatarUrl}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
    if (menuAvatar) menuAvatar.innerHTML = `<img src="${avatarUrl}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
  } else {
    headerBtn.textContent = initial;
    if (menuAvatar) menuAvatar.textContent = initial;
  }
}

export function updateHeaderUser() {
  if (!state.currentUser) return;
  updateAvatarDisplay();
  const name = (state.currentUser.user_metadata && state.currentUser.user_metadata.name) || state.currentUser.email;
  document.getElementById('user-menu-name').textContent = name;
  document.getElementById('user-menu-email').textContent = state.currentUser.email;
}

export function openProfileDrawer() {
  const name = (state.currentUser.user_metadata && state.currentUser.user_metadata.name) || '';
  const avatarUrl = state.currentUser.user_metadata && state.currentUser.user_metadata.avatar_url;

  document.getElementById('profile-name').value = name;
  document.getElementById('profile-email-ro').value = state.currentUser.email;

  const pa = document.getElementById('profile-avatar');
  if (avatarUrl) {
    pa.innerHTML = `<img src="${avatarUrl}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
  } else {
    pa.textContent = userInitial(state.currentUser);
    pa.style.fontSize = '28px';
  }

  updateThemeButtons(localStorage.getItem('app-theme') || 'system');
  document.getElementById('profile-overlay').classList.add('open');
  document.getElementById('profile-drawer').classList.add('open');
}

export function closeProfileDrawer() {
  document.getElementById('profile-overlay').classList.remove('open');
  document.getElementById('profile-drawer').classList.remove('open');
}

export function triggerAvatarUpload() {
  document.getElementById('avatar-file-input').click();
}

export async function handleAvatarChange(input) {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) { showToast('Image must be under 5 MB'); return; }

  const ext = file.name.split('.').pop().toLowerCase();
  const path = `${state.currentUser.id}/avatar.${ext}`;

  showToast('Uploading...');
  const { error: upErr } = await uploadAvatar(path, file);
  if (upErr) { showToast('Upload failed'); return; }

  const { data: urlData } = getAvatarPublicUrl(path);
  const avatarUrl = urlData.publicUrl + '?t=' + Date.now();

  const { error: updErr } = await updateUserData({ avatar_url: avatarUrl });
  if (updErr) { showToast('Could not save avatar'); return; }

  state.currentUser.user_metadata = { ...state.currentUser.user_metadata, avatar_url: avatarUrl };
  updateAvatarDisplay();

  const pa = document.getElementById('profile-avatar');
  pa.innerHTML = `<img src="${avatarUrl}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
  input.value = '';
  showToast('Photo updated!');
}

export async function saveProfile() {
  const name = document.getElementById('profile-name').value.trim();
  if (!name) { showToast('Enter a name'); return; }

  const { error } = await updateUserData({ name });
  if (error) { showToast('Could not save'); return; }

  state.currentUser.user_metadata = { ...state.currentUser.user_metadata, name };
  updateHeaderUser();
  closeProfileDrawer();
  showToast('Profile updated!');
}

export function openDeleteModal() {
  document.getElementById('delete-modal-overlay').style.display = 'block';
  document.getElementById('delete-modal').classList.add('open');
}

export function closeDeleteModal() {
  document.getElementById('delete-modal-overlay').style.display = 'none';
  document.getElementById('delete-modal').classList.remove('open');
}

export async function deleteAccount() {
  closeDeleteModal();
  showToast('Deleting account...');

  if (state.householdData) {
    await db.from('household_members')
      .delete().eq('household_id', state.householdData.id).eq('user_id', state.currentUser.id);
  }

  const { error } = await deleteUserAccount();
  if (error) { showToast('Could not delete account — contact support'); return; }

  showToast('Account deleted');
  await authSignOut();
}
