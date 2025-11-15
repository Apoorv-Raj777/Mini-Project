// /frontend/js/auth.js
// Firebase Google-only auth helper (compat SDK).
// - Supports oauthSignIn('google') used by auth.html
// - Detects when the sign-in created a new user and shows a brief success modal with user's name.
// - Saves idToken and user profile to localStorage.
// - Exposes logout(), getStoredUser(), getIdToken(), oauthSignIn().

const FIREBASE_CONFIG = {
    apiKey: "AIzaSyCxKi1tJGX5u3vaubrsN4HyE_vh4lHwEnI",
    authDomain: "sarthi-f8514.firebaseapp.com",
    projectId: "sarthi-f8514",
    storageBucket: "sarthi-f8514.firebasestorage.app",
    messagingSenderId: "96970206340",
    appId: "1:96970206340:web:b3c3f1f43e9dc8237b66d1",
    measurementId: "G-BNZQ393PXH"
  };

const REDIRECT_AFTER_LOGIN = '/dashboard.html';
const OAUTH_POPUP_OPTIONS = 'width=520,height=650,menubar=no,toolbar=no,status=no,resizable=yes,scrollbars=yes';

if (!window.firebase || !window.firebase.apps || !window.firebase.apps.length) {
  firebase.initializeApp(FIREBASE_CONFIG);
}
const auth = firebase.auth();
const googleProvider = new firebase.auth.GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

function showModalWelcome(name, photoUrl) {
  try {
    const modal = document.getElementById('signupModal');
    const modalName = document.getElementById('modalName');
    const modalAvatar = document.getElementById('modalAvatar');
    if (!modal || !modalName) return;
    modalName.textContent = name || 'Friend';
    if (modalAvatar && photoUrl) modalAvatar.src = photoUrl;
    modal.style.display = 'flex';
    // auto-hide after 1.8s then redirect
    setTimeout(() => {
      modal.style.display = 'none';
      window.location.href = REDIRECT_AFTER_LOGIN;
    }, 1800);
  } catch (e) { console.warn(e); window.location.href = REDIRECT_AFTER_LOGIN; }
}

function saveUserData(idToken, user) {
  try {
    if (idToken) localStorage.setItem('auth_token', idToken);
    if (user) localStorage.setItem('auth_user', JSON.stringify(user));
  } catch (e) { console.warn('storage error', e); }
}

// Public: start Google sign-in (popup)
// options: { redirectPath } - not used here but kept for compatibility
export async function oauthSignIn(provider = 'google', options = {}) {
  if (provider !== 'google') throw new Error('Only google provider supported in this flow');
  try {
    // signInWithPopup returns a result that includes additionalUserInfo.isNewUser
    const result = await auth.signInWithPopup(googleProvider);
    const user = result.user;
    const additional = result.additionalUserInfo || {};
    const isNew = !!additional.isNewUser;

    // get ID token
    const idToken = await user.getIdToken();

    const profile = {
      uid: user.uid,
      name: user.displayName || '',
      email: user.email || '',
      picture: user.photoURL || ''
    };
    saveUserData(idToken, profile);

    if (isNew) {
      // show welcome modal with name then redirect
      showModalWelcome(profile.name, profile.picture);
      // Optionally: call backend to create/link user. Example:
      // await fetch('/api/auth/firebase', { method:'POST', headers:{ 'Authorization': 'Bearer ' + idToken } });
    } else {
      // existing user: redirect immediately
      window.location.href = REDIRECT_AFTER_LOGIN;
    }
    return { token: idToken, user: profile, isNew };
  } catch (err) {
    // bubble up error
    throw err;
  }
}

// Helpers:
export async function getIdToken() {
  const user = auth.currentUser;
  if (user) {
    try {
      return await user.getIdToken();
    } catch (e) {
      console.warn('getIdToken error', e);
    }
  }
  return localStorage.getItem('auth_token') || null;
}

export function getStoredUser() {
  try {
    const s = localStorage.getItem('auth_user');
    return s ? JSON.parse(s) : null;
  } catch (e) { return null; }
}

export async function logout() {
  try {
    await auth.signOut();
  } catch (e) { console.warn('signout failed', e); }
  try {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_user');
  } catch (e) {}
  window.location.href = '/';
}

// Auto-redirect behavior if user already signed in and visits login page:
auth.onAuthStateChanged(async (user) => {
  if (!user) return;
  // If already signed in and currently on auth pages, redirect to dashboard
  const path = window.location.pathname;
  if (path.endsWith('/auth.html') || path.endsWith('/login.html') || path === '/' || path.endsWith('/index.html')) {
    // ensure we have token & profile saved
    try {
      const token = await user.getIdToken();
      const profile = { uid: user.uid, name: user.displayName || '', email: user.email || '', picture: user.photoURL || '' };
      saveUserData(token, profile);
      // If the user is new we cannot detect that here; this code just redirects.
      window.location.href = REDIRECT_AFTER_LOGIN;
    } catch(e) { console.warn(e); }
  }
});
