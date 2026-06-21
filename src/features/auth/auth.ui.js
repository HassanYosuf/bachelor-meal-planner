import { state } from '../../core/state.js';
import { db } from '../../core/supabase.js';
import { showToast } from '../../utils/toast.js';
import { userInitial } from '../../utils/format.js';
import { updateThemeButtons } from '../../utils/theme.js';
import {
  signIn, signUp, resetPasswordForEmail, updatePassword,
  updateUserData, authSignOut, uploadAvatar, getAvatarPublicUrl,
  deleteUserAccount, signInWithGoogle as googleOAuth,
} from './auth.service.js';
import { showApp } from '../../core/router.js';
import { updateMemberDisplayName } from '../household/household.service.js';

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

  try {
    let result;
    if (state.authMode === 'signin') {
      result = await signIn(email, password);
    } else {
      const name = document.getElementById('auth-name').value.trim();
      result = await signUp(email, password, name);
    }

    console.log('Auth result:', result);

    btn.disabled = false;
    btn.textContent = state.authMode === 'signin' ? 'Sign in' : 'Create account';

    if (result.error) {
      errEl.textContent = result.error.message;
      return;
    }

    if (state.authMode === 'signup') {
      if (result.data?.session) {
        state.currentUser = result.data.session.user;
        await showApp();
      } else if (result.data?.user) {
        document.getElementById('auth-confirm-email').textContent = result.data.user.email;
        showAuthState('confirm');
      } else {
        errEl.textContent = 'Sign up failed — please try again.';
      }
    } else {
      if (!result.data?.user) {
        errEl.textContent = 'Sign in failed — please try again.';
        return;
      }
      state.currentUser = result.data.user;
      await showApp();
    }
  } catch (e) {
    btn.disabled = false;
    btn.textContent = state.authMode === 'signin' ? 'Sign in' : 'Create account';
    console.error('Auth error:', e);
    errEl.textContent = 'Error: ' + (e.message || String(e));
  }
}

export async function signInWithGoogle() {
  const btn = document.getElementById('google-signin-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Connecting...'; }
  const errEl = document.getElementById('auth-error');
  errEl.textContent = '';

  const { error } = await googleOAuth();
  if (error) {
    errEl.textContent = error.message;
    if (btn) { btn.disabled = false; btn.innerHTML = googleBtnHTML(); }
  }
  // On success, browser redirects — no further handling needed here
}

function googleBtnHTML() {
  return `<svg width="18" height="18" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" style="flex-shrink:0">
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.35-8.16 2.35-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
    <path fill="none" d="M0 0h48v48H0z"/>
  </svg>
  Continue with Google`;
}

export async function submitForgotPassword() {
  const email = document.getElementById('forgot-email').value.trim();
  const errEl = document.getElementById('forgot-error');
  const btn = document.querySelector('#auth-state-forgot .auth-btn');
  errEl.textContent = '';
  if (!email) { errEl.textContent = 'Enter your email'; return; }

  if (btn) { btn.disabled = true; btn.textContent = '...'; }

  try {
    const { error } = await resetPasswordForEmail(email, window.location.origin);
    if (error) { errEl.textContent = error.message; return; }
    document.getElementById('reset-sent-email').textContent = email;
    showAuthState('reset-sent');
  } catch (e) {
    console.error('Reset error:', e);
    errEl.textContent = 'Error: ' + (e.message || String(e));
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Send reset link'; }
  }
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

export function togglePw(inputId, btn) {
  const input = document.getElementById(inputId);
  const isHidden = input.type === 'password';
  input.type = isHidden ? 'text' : 'password';
  btn.querySelector('.eye-icon').style.display = isHidden ? 'none' : '';
  btn.querySelector('.eye-off-icon').style.display = isHidden ? '' : 'none';
}

export async function signOut() {
  await authSignOut();
  document.getElementById('user-menu').style.display = 'none';
}

export function toggleUserMenu() {
  const m = document.getElementById('user-menu');
  m.style.display = m.style.display === 'none' ? 'block' : 'none';
}

function getUserDisplayName(user) {
  const m = user.user_metadata || {};
  return m.name || m.full_name || user.email;
}

function getUserAvatarUrl(user) {
  const m = user.user_metadata || {};
  return m.avatar_url || m.picture || null;
}

export function updateAvatarDisplay() {
  const avatarUrl = getUserAvatarUrl(state.currentUser);
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
  document.getElementById('user-menu-name').textContent = getUserDisplayName(state.currentUser);
  document.getElementById('user-menu-email').textContent = state.currentUser.email;
}

export function openProfileDrawer() {
  try {
    const m = state.currentUser.user_metadata || {};
    const name = m.name || m.full_name || '';
    const avatarUrl = getUserAvatarUrl(state.currentUser);

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
  } catch (e) {
    console.error('openProfileDrawer error:', e);
    showToast('Could not open profile: ' + e.message);
  }
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

  // Keep household_members.display_name in sync
  if (state.householdData) {
    await updateMemberDisplayName(state.householdData.id, state.currentUser.id, name);
    if (state.selfMember) state.selfMember.display_name = name;
  }

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
