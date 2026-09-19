(function () {
  'use strict';

  const rowsEl = document.getElementById('rows');
  const tallyEl = document.getElementById('tally');
  const form = document.getElementById('add-form');
  const dot = document.getElementById('live-dot');
  const connLabel = document.getElementById('conn-label');

  const STATES = ['available', 'busy', 'away'];
  const LABELS = { available: 'Available', busy: 'Busy', away: 'Away' };

  let socket = null;
  let retryDelay = 1000;
  let pollTimer = null;

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  function render(members, summary) {
    if (!members || !members.length) {
      rowsEl.innerHTML = '<div class="empty-state">No one on the board yet — add your first teammate below.</div>';
      tallyEl.innerHTML = '';
      return;
    }

    const counts = summary || members.reduce(function (acc, m) {
      acc[m.status] = (acc[m.status] || 0) + 1;
      return acc;
    }, { available: 0, busy: 0, away: 0 });

    tallyEl.innerHTML = STATES.map(function (s) {
      return '<span><span class="n">' + (counts[s] || 0) + '</span>' + LABELS[s] + '</span>';
    }).join('');

    rowsEl.innerHTML = members.map(function (m) {
      const name = escapeHtml(m.name);
      const role = m.role ? '<div class="role">' + escapeHtml(m.role) + '</div>' : '';
      const status = STATES.indexOf(m.status) >= 0 ? m.status : 'available';
      const toggles = STATES.map(function (s) {
        return '<button type="button" data-state="' + s + '" data-id="' + m.id + '" class="' +
          (s === status ? 'active' : '') + '" aria-pressed="' + (s === status) + '">' + LABELS[s] + '</button>';
      }).join('');
      return '<div class="row" data-id="' + m.id + '">' +
        '<div class="row-main"><div class="who"><div class="name">' + name + '</div>' + role + '</div></div>' +
        '<div class="toggle" role="group" aria-label="Status for ' + name + '">' + toggles + '</div>' +
        '<button class="remove-btn" data-remove="' + m.id + '" aria-label="Remove ' + name + '" title="Remove">&times;</button>' +
        '</div>';
    }).join('');
  }

  function setConnected(on) {
    dot.classList.toggle('offline', !on);
    connLabel.textContent = on ? 'Synced live' : 'Reconnecting — showing the last known board';
  }

  async function loadBoard() {
    try {
      const res = await fetch('/api/members');
      if (!res.ok) throw new Error('Request failed');
      const data = await res.json();
      render(data.members, data.summary);
    } catch (err) {
      rowsEl.innerHTML = '<div class="empty-state">The board couldn\'t reach the server. Check that it\'s running, then reload.</div>';
    }
  }

  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(loadBoard, 5000);
  }

  function stopPolling() {
    if (!pollTimer) return;
    clearInterval(pollTimer);
    pollTimer = null;
  }

  function connect() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    socket = new WebSocket(proto + '//' + location.host + '/ws');

    socket.addEventListener('open', function () {
      setConnected(true);
      stopPolling();
      retryDelay = 1000;
    });

    socket.addEventListener('message', function (event) {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'board') render(msg.members, msg.summary);
      } catch (err) { /* ignore malformed frames */ }
    });

    socket.addEventListener('close', function () {
      setConnected(false);
      startPolling();
      setTimeout(connect, retryDelay);
      retryDelay = Math.min(retryDelay * 2, 15000);
    });

    socket.addEventListener('error', function () {
      try { socket.close(); } catch (err) { /* already closing */ }
    });
  }

  rowsEl.addEventListener('click', async function (e) {
    const toggleBtn = e.target.closest('button[data-state]');
    if (toggleBtn) {
      await fetch('/api/members/' + toggleBtn.dataset.id + '/status', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: toggleBtn.dataset.state })
      }).catch(function () {});
      return;
    }
    const removeBtn = e.target.closest('button[data-remove]');
    if (removeBtn) {
      await fetch('/api/members/' + removeBtn.dataset.remove, { method: 'DELETE' }).catch(function () {});
    }
  });

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    const nameInput = form.elements.name;
    const roleInput = form.elements.role;
    const name = nameInput.value.trim();
    if (!name) return;
    await fetch('/api/members', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name, role: roleInput.value.trim() })
    }).catch(function () {});
    nameInput.value = '';
    roleInput.value = '';
    nameInput.focus();
  });

  loadBoard();
  connect();
})();
