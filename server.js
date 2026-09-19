'use strict';

const http = require('http');
const path = require('path');
const express = require('express');
const { WebSocketServer } = require('ws');
const store = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

store.seedIfEmpty();

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

/* Push the whole board to every connected client. Small payload, so a full
   snapshot is simpler and safer than diffing. */
function broadcast() {
  const payload = JSON.stringify({
    type: 'board',
    members: store.listMembers(),
    summary: store.summary(),
    at: new Date().toISOString()
  });
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(payload);
  }
}

wss.on('connection', (socket) => {
  socket.send(JSON.stringify({
    type: 'board',
    members: store.listMembers(),
    summary: store.summary(),
    at: new Date().toISOString()
  }));
  socket.isAlive = true;
  socket.on('pong', () => { socket.isAlive = true; });
});

/* Drop dead connections so broadcasts stay cheap. */
const heartbeat = setInterval(() => {
  for (const socket of wss.clients) {
    if (socket.isAlive === false) { socket.terminate(); continue; }
    socket.isAlive = false;
    socket.ping();
  }
}, 30000);
wss.on('close', () => clearInterval(heartbeat));

/* ---------------------------- REST API ---------------------------- */

app.get('/api/health', (req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

app.get('/api/members', (req, res) => {
  res.json({ members: store.listMembers(), summary: store.summary() });
});

app.get('/api/members/:id', (req, res) => {
  const member = store.getMember(Number(req.params.id));
  if (!member) return res.status(404).json({ error: 'No member with that id.' });
  res.json({ member, history: store.historyFor(member.id) });
});

app.post('/api/members', (req, res) => {
  try {
    const member = store.createMember(req.body || {});
    broadcast();
    res.status(201).json({ member });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.patch('/api/members/:id/status', (req, res) => {
  const { status, note } = req.body || {};
  if (!store.VALID_STATUSES.includes(status)) {
    return res.status(400).json({
      error: 'Status must be one of: ' + store.VALID_STATUSES.join(', ')
    });
  }
  const member = store.setStatus(Number(req.params.id), status, note);
  if (!member) return res.status(404).json({ error: 'No member with that id.' });
  broadcast();
  res.json({ member });
});

app.patch('/api/members/:id', (req, res) => {
  const member = store.updateMember(Number(req.params.id), req.body || {});
  if (!member) return res.status(404).json({ error: 'No member with that id.' });
  broadcast();
  res.json({ member });
});

app.delete('/api/members/:id', (req, res) => {
  const removed = store.deleteMember(Number(req.params.id));
  if (!removed) return res.status(404).json({ error: 'No member with that id.' });
  broadcast();
  res.status(204).end();
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Unknown endpoint.' }));

server.listen(PORT, () => {
  console.log(`Availability board running on http://localhost:${PORT}`);
});
