// /frontend/js/dashboard.js
// Dashboard logic. Uses Firebase auth helpers exported from /js/auth.js
// Exports: none (runs on load)

// Import the auth helpers from the auth module.
// Use absolute path so module resolution works when loading from any page.
import { getIdToken, getStoredUser, logout } from '/js/auth.js';

const $ = (s) => document.querySelector(s);
const tbody = $('#auditsTable tbody');
const auditsEmpty = $('#auditsEmpty');

let map, markersLayer;

// Bootstrap
document.addEventListener('DOMContentLoaded', async () => {
  // 1) Ensure user logged in (check stored user first)
  const storedUser = getStoredUser();
  if (!storedUser) {
    // Try to see if there's a token and let auth.js handle redirect; otherwise go to /auth.html
    window.location.href = '/auth.html';
    return;
  }

  // populate profile UI
  $('#userName').textContent = storedUser.name || 'User';
  $('#userEmail').textContent = storedUser.email || '';
  if (storedUser.picture) $('#avatarImg').src = storedUser.picture;

  // bind logout
  $('#btnLogout').addEventListener('click', async () => {
    await logout();
  });

  // bind export
  $('#btnExport').addEventListener('click', exportCSV);

  // init map
  try { initMap(); } catch (e) {
    console.warn('Map init failed', e);
    $('#userMap').textContent = 'Map cannot be initialized.';
  }

  // fetch user audits from backend
  try {
    const data = await fetchUserAudits();
    renderStats(data);
    renderAuditsTable(data);
    renderOnMap(data);
  } catch (err) {
    console.error('Failed loading audits', err);
    if (err.status === 401) {
      // not authorized, force login
      window.location.href = '/auth.html';
      return;
    }
    // show empty state
    tbody.innerHTML = '';
    auditsEmpty.style.display = 'block';
  }
});

async function authFetch(path, opts = {}) {
  const token = await getIdToken();
  const headers = { ...(opts.headers || {}) };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  // don't force JSON response for non-GET (we use GET here)
  const res = await fetch(path, { ...opts, headers });
  if (!res.ok) {
    const txt = await res.text().catch(()=>null);
    const err = new Error(txt || `Request failed: ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json().catch(()=>null);
}

async function fetchUserAudits() {
  // Default: try /api/user/audits. If your backend uses another route, change this.
  const endpoint = '/api/user/audits';
  return await authFetch(endpoint, { method: 'GET' });
}

function renderStats(audits = []) {
  $('#totalAudits').textContent = audits.length || 0;
  const areas = new Set(audits.map(a => `${(a.lat||0).toFixed(3)},${(a.lng||0).toFixed(3)}`));
  $('#areasMapped').textContent = areas.size;
}

function renderAuditsTable(audits = []) {
  tbody.innerHTML = '';
  if (!audits || !audits.length) {
    auditsEmpty.style.display = 'block';
    return;
  }
  auditsEmpty.style.display = 'none';
  // show newest first (assumes timestamp in seconds or iso)
  audits.sort((a,b) => {
    const ta = a.timestamp ? a.timestamp : (a.created_at ? new Date(a.created_at).getTime()/1000 : 0);
    const tb = b.timestamp ? b.timestamp : (b.created_at ? new Date(b.created_at).getTime()/1000 : 0);
    return tb - ta;
  }).slice(0,200).forEach(a => {
    const tr = document.createElement('tr');
    const when = a.timestamp ? new Date(a.timestamp * 1000).toLocaleString() : (a.created_at ? new Date(a.created_at).toLocaleString() : '—');
    const lat = (typeof a.lat === 'number') ? a.lat.toFixed(5) : (a.latitude ?? '—');
    const lng = (typeof a.lng === 'number') ? a.lng.toFixed(5) : (a.longitude ?? '—');
    const score = (a.calculated_score !== undefined && a.calculated_score !== null) ? Number(a.calculated_score).toFixed(2) : (a.score !== undefined ? a.score : '—');
    tr.innerHTML = `<td>${when}</td><td>${lat}</td><td>${lng}</td><td>${score}</td>`;
    tbody.appendChild(tr);
  });
}

function initMap() {
  if (!window.L) {
    document.getElementById('userMap').textContent = 'Leaflet not loaded. Please add Leaflet library.';
    return;
  }
  map = L.map('userMap', { center: [20.5937,78.9629], zoom: 5, scrollWheelZoom: false });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
  markersLayer = L.layerGroup().addTo(map);
}

function renderOnMap(audits = []) {
  if (!map || !markersLayer) return;
  markersLayer.clearLayers();
  const bounds = [];
  for (const a of audits) {
    const lat = (typeof a.lat === 'number') ? a.lat : (typeof a.latitude === 'number' ? a.latitude : null);
    const lng = (typeof a.lng === 'number') ? a.lng : (typeof a.longitude === 'number' ? a.longitude : null);
    if (lat === null || lng === null) continue;
    const score = (a.calculated_score !== undefined) ? a.calculated_score : (a.score !== undefined ? a.score : null);
    const color = score === null ? '#888' : (score > 0.66 ? '#20c997' : (score > 0.33 ? '#ffbf00' : '#ff6b6b'));
    const m = L.circleMarker([lat, lng], { radius: 7, fillColor: color, color: '#fff', weight: 1, fillOpacity: 0.9 });
    const when = a.timestamp ? new Date(a.timestamp*1000).toLocaleString() : (a.created_at ? new Date(a.created_at).toLocaleString() : '—');
    m.bindPopup(`<strong>Score:</strong> ${score ?? '—'}<br><strong>When:</strong> ${when}`);
    m.addTo(markersLayer);
    bounds.push([lat, lng]);
  }
  if (bounds.length) map.fitBounds(bounds, { padding: [20,20], maxZoom: 15 });
}

// Export CSV
function exportCSV() {
  fetchUserAudits().then(audits => {
    if (!audits || audits.length === 0) {
      alert('No audits to export');
      return;
    }
    const header = ['timestamp','lat','lng','score','notes'];
    const rows = audits.map(a => {
      const when = a.timestamp ? new Date(a.timestamp*1000).toISOString() : (a.created_at ? new Date(a.created_at).toISOString() : '');
      const lat = a.lat ?? a.latitude ?? '';
      const lng = a.lng ?? a.longitude ?? '';
      const score = a.calculated_score ?? a.score ?? '';
      const notes = (a.notes || a.comment || '').replace(/"/g,'""').replace(/\n/g,' ');
      return [when, lat, lng, score, notes];
    });
    const csv = [header.join(','), ...rows.map(r => r.map(col => `"${String(col).replace(/"/g,'""')}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audits_export_${Date.now()}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }).catch(err => {
    alert('Export failed: ' + (err.message || 'unknown'));
    console.error(err);
  });
}
