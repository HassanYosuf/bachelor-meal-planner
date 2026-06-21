import { db } from '../../core/supabase.js';

export async function signIn(email, password) {
  return db.auth.signInWithPassword({ email, password });
}

export async function signUp(email, password, name) {
  return db.auth.signUp({
    email,
    password,
    options: { data: { name: name || email.split('@')[0] } },
  });
}

export async function resetPasswordForEmail(email, redirectTo) {
  return db.auth.resetPasswordForEmail(email, { redirectTo });
}

export async function updatePassword(password) {
  return db.auth.updateUser({ password });
}

export async function updateUserData(data) {
  return db.auth.updateUser({ data });
}

export async function authSignOut() {
  return db.auth.signOut();
}

export async function getSession() {
  return db.auth.getSession();
}

export function onAuthStateChange(callback) {
  return db.auth.onAuthStateChange(callback);
}

export async function uploadAvatar(path, file) {
  return db.storage.from('avatars').upload(path, file, { upsert: true });
}

export function getAvatarPublicUrl(path) {
  return db.storage.from('avatars').getPublicUrl(path);
}

export async function deleteUserAccount() {
  return db.rpc('delete_user');
}

export async function signInWithGoogle() {
  return db.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin },
  });
}
