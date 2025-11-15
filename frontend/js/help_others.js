// /frontend/js/help_others.js
// Page logic for /pages/help_others.html (Submit audit page renamed "Help Others!")
// - Uses getIdToken(), getStoredUser() from /js/auth.js
// - Uses initSubmitMap from /js/map.js if available (fallback otherwise)
// - Redirects to auth.html?mode=signup&next=<current_page> when user tries to submit linked audit but is not signed in

import { getIdToken, getStoredUser } from '/js/auth.js';

const $ = (s) => document.querySelector(s);
let mapObj = null;

// Try to initialize map using map.js if present
async function tryInitMap() {
  try {
    // dynamic import so the page still works even if map.js not present yet
    const mod = await import('/js/map.js');
    if (mod && typeof mod.initSubmitMap === 'function') {
      mapObj = mod.initSubmitMap('auditMap', ([lat, lng]) => {
        $('#lat').value = lat.toFixed(6);
        $('#lng').value = lng.toFixed(6);
        $('#posText').textContent = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
        $('#btnSubmit').disabled = false;
        setFeedback('Location set. Fill the rest and submit.', 'var(--muted)');
      });
    } else {
      $('#auditMap').textContent = 'Map helper not available.';
    }
  } catch (err) {
    console.warn('map.js not available or failed to load', err);
    // fallback: show a helpful message
    $('#auditMap').textContent = 'Map not loaded — add /js/map.js or ensure Leaflet is available.';
  }
}

function setFeedback(msg, color = 'var(--muted)') {
  const el = $('#formFeedback');
  if (!el) return;
  el.style.color = color;
  el.textContent = msg || '';
}

function clearForm() {
  $('#lat').value = '';
  $('#lng').value = '';
  $('#notes').value = '';
  $('#lighting').value = '2';
  $('#visibility').value = '2';
  $('#cctv').value = 'false';
  $('#crowd').value = 'low';
  $('#crime').value = 'none';
  $('#security').value = 'false';
  $('#anonymous').value = 'false';
  $('#posText').textContent = 'not set';
  setFeedback('');
  if (mapObj && mapObj.clearMarker) mapObj.clearMarker();
}

function validatePayload(payload) {
  if (!payload.lat || !payload.lng) return 'Please set a location on the map.';
  const lat = Number(payload.lat), lng = Number(payload.lng);
  if (Number.isNaN(lat) || Number.isNaN(lng)) return 'Invalid coordinates.';
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return 'Coordinates out of range.';
  return null;
}

// When user clicks submit:
async function submitAudit() {
  setFeedback('');
  const payload = {
    lat: Number($('#lat').value || null),
    lng: Number($('#lng').value || null),
    lighting: Number($('#lighting').value),
    visibility: Number($('#visibility').value),
    cctv: $('#cctv').value === 'true',
    crowd_density: $('#crowd').value,
    crime_observed: $('#crime').value,
    security_present: $('#security').value === 'true',
    notes: $('#notes').value.trim() || null,
    timestamp: Math.floor(Date.now() / 1000)
  };

  const anonymous = ($('#anonymous').value === 'true');

  const v = validatePayload(payload);
  if (v) { setFeedback(v, 'var(--danger)'); return; }

  // if user wants to link to account, ensure they are signed in
  if (!anonymous) {
    const stored = getStoredUser();
    if (!stored) {
      // redirect user to auth page, and include next param to come back
      const next = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.href = `/auth.html?mode=signup&next=${next}`;
      return;
    }
  }

  // send to backend
  try {
    setFeedback('Submitting…', 'var(--muted)');
    const headers = { 'Content-Type': 'application/json' };
    if (!anonymous) {
      const token = await getIdToken();
      if (token) headers['Authorization'] = `Bearer ${token}`;
    }
    const res = await fetch('/api/submit_audit', {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const txt = await res.text().catch(()=>null);
      throw new Error(txt || `Server error ${res.status}`);
    }
    setFeedback('Thanks — your audit was submitted!', 'var(--success)');
    // optionally clear after a short delay
    setTimeout(() => clearForm(), 900);
  } catch (err) {
    console.error('submit error', err);
    setFeedback('Submit failed: ' + (err.message || 'unknown'), 'var(--danger)');
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  // Wire buttons
  $('#btnSubmit').addEventListener('click', submitAudit);
  $('#btnClear').addEventListener('click', clearForm);

  // Disable submit until location selected
  $('#btnSubmit').disabled = true;

  // initialize map helper (if present)
  await tryInitMap();

  // If user returned from auth flow, firebase auth.js should have stored user & token.
  // If you want to auto-enable submit after auth, that will be handled naturally by getStoredUser() check above.
});
