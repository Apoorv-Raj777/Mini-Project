// /frontend/js/ui_helpers.js
// Enhances header after injection:
//  - sets signup/login links with ?next= current page
//  - shows user avatar/name and a small accessible dropdown (Dashboard / Profile / Sign out)

import { getStoredUser, logout } from '/js/auth.js';

window.onHeaderInjected = () => {
  const currentPath = window.location.pathname + window.location.search;

  // --- enforce signup/login links with next param ---
  const signupLink = document.querySelector('.header-actions a.btn-primary.small');
  if (signupLink) signupLink.href = `/auth.html?mode=signup&next=${encodeURIComponent(currentPath)}`;

  const loginLink = document.querySelector('.header-actions a.btn-outline');
  if (loginLink) loginLink.href = `/auth.html?next=${encodeURIComponent(currentPath)}`;

  const headerActions = document.querySelector('.header-actions');
  if (!headerActions) return;

  // Helper: escape text
  const esc = (s='') => String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

  // Render header actions based on stored user
  function renderHeaderUser() {
    const user = getStoredUser();
    if (!user) {
      // default buttons
      headerActions.innerHTML = `
        <a href="/auth.html" class="btn-outline">Log in</a>
        <a href="/auth.html?mode=signup" class="btn-primary small">Sign Up</a>
      `;
      // reapply next param
      const su = headerActions.querySelector('.btn-primary.small');
      if (su) su.href = `/auth.html?mode=signup&next=${encodeURIComponent(currentPath)}`;
      const li = headerActions.querySelector('.btn-outline');
      if (li) li.href = `/auth.html?next=${encodeURIComponent(currentPath)}`;
      return;
    }

    const name = esc(user.name || user.email || 'Me');
    const avatar = esc(user.picture || '/assets/google_icon.svg');

    headerActions.innerHTML = `
      <div class="profile-menu" style="position:relative;display:inline-block">
        <button id="profileToggle" aria-haspopup="true" aria-expanded="false"
          style="display:flex;align-items:center;gap:8px;background:transparent;border:0;cursor:pointer;padding:6px">
          <img src="${avatar}" alt="${name}" class="header-avatar" style="width:36px;height:36px;border-radius:8px;object-fit:cover">
          <span class="header-username" style="font-weight:600;font-size:0.95rem">${name}</span>
        </button>

        <div id="profileDropdown" role="menu" aria-hidden="true"
          style="position:absolute;right:0;top:48px;min-width:180px;background:var(--card-bg, #0b0b0b);border:1px solid rgba(255,255,255,0.06);border-radius:8px;padding:8px;box-shadow:0 6px 20px rgba(0,0,0,0.6);display:none;z-index:1200">
          <a href="/pages/dashboard.html" role="menuitem" class="menu-item" style="display:block;padding:8px;border-radius:6px;">Dashboard</a>
          <a href="/pages/profile.html" role="menuitem" class="menu-item" style="display:block;padding:8px;border-radius:6px;">Profile</a>
          <button id="headerSignoutBtn" role="menuitem" class="menu-item" style="display:block;padding:8px;border-radius:6px;width:100%;text-align:left;background:transparent;border:0;cursor:pointer;">Sign out</button>
        </div>
      </div>
    `;

    const toggle = document.getElementById('profileToggle');
    const dropdown = document.getElementById('profileDropdown');
    const signoutBtn = document.getElementById('headerSignoutBtn');

    if (!toggle || !dropdown) return;

    function openDropdown() {
      dropdown.style.display = 'block';
      dropdown.setAttribute('aria-hidden', 'false');
      toggle.setAttribute('aria-expanded', 'true');
      // focus the first actionable item
      const first = dropdown.querySelector('[role="menuitem"]');
      if (first) first.focus();
      // attach outside click handler
      window.addEventListener('click', onOutsideClick);
      window.addEventListener('keydown', onKeyDown);
    }

    function closeDropdown() {
      dropdown.style.display = 'none';
      dropdown.setAttribute('aria-hidden', 'true');
      toggle.setAttribute('aria-expanded', 'false');
      window.removeEventListener('click', onOutsideClick);
      window.removeEventListener('keydown', onKeyDown);
    }

    function onOutsideClick(e) {
      if (!dropdown.contains(e.target) && !toggle.contains(e.target)) closeDropdown();
    }

    function onKeyDown(e) {
      if (e.key === 'Escape') closeDropdown();
    }

    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      const expanded = toggle.getAttribute('aria-expanded') === 'true';
      if (expanded) closeDropdown(); else openDropdown();
    });

    signoutBtn && signoutBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      try {
        await logout();
      } catch (err) {
        console.warn('logout failed', err);
      } finally {
        // re-render header to login/signup
        renderHeaderUser();
      }
    });

    // close when navigation occurs (conservative)
    const menuLinks = dropdown.querySelectorAll('a[role="menuitem"]');
    menuLinks.forEach(a => a.addEventListener('click', () => closeDropdown()));
  }

  // initial render and react to storage events (other tabs)
  renderHeaderUser();
  window.addEventListener('storage', (ev) => {
    if (ev.key === 'sarthi_user_v1') renderHeaderUser();
  });

  // small delayed refresh to capture immediate sign-ins
  setTimeout(renderHeaderUser, 700);
};
