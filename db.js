'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'availability.db'));
db.pragma('journal_mode = WAL');

/*
 * Schema
 * ------
 * members        one row per teammate, holding their current status flag
 * status_history append-only audit trail of every status change
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS members (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    role        TEXT NOT NULL DEFAULT '',
    status      TEXT NOT NULL DEFAULT 'available'
                CHECK (status IN ('available', 'busy', 'away')),
    note        TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS status_history (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id   INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    status      TEXT NOT NULL,
    changed_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_members_status ON members(status);
  CREATE INDEX IF NOT EXISTS idx_history_member ON status_history(member_id);
`);

const VALID_STATUSES = ['available', 'busy', 'away'];

const stmts = {
  listMembers: db.prepare('SELECT * FROM members ORDER BY name COLLATE NOCASE ASC'),
  getMember: db.prepare('SELECT * FROM members WHERE id = ?'),
  insertMember: db.prepare(
    'INSERT INTO members (name, role, status) VALUES (@name, @role, @status)'
  ),
  updateStatus: db.prepare(
    "UPDATE members SET status = @status, note = @note, updated_at = datetime('now') WHERE id = @id"
  ),
  updateMember: db.prepare(
    "UPDATE members SET name = @name, role = @role, updated_at = datetime('now') WHERE id = @id"
  ),
  deleteMember: db.prepare('DELETE FROM members WHERE id = ?'),
  addHistory: db.prepare('INSERT INTO status_history (member_id, status) VALUES (?, ?)'),
  historyFor: db.prepare(
    'SELECT status, changed_at FROM status_history WHERE member_id = ? ORDER BY id DESC LIMIT 20'
  ),
  countMembers: db.prepare('SELECT COUNT(*) AS n FROM members'),
  summary: db.prepare('SELECT status, COUNT(*) AS n FROM members GROUP BY status')
};

function listMembers() {
  return stmts.listMembers.all();
}

function getMember(id) {
  return stmts.getMember.get(id);
}

function createMember({ name, role = '', status = 'available' }) {
  if (!name || !String(name).trim()) throw new Error('A name is required.');
  if (!VALID_STATUSES.includes(status)) throw new Error('Unknown status.');
  const info = stmts.insertMember.run({
    name: String(name).trim().slice(0, 80),
    role: String(role || '').trim().slice(0, 80),
    status
  });
  stmts.addHistory.run(info.lastInsertRowid, status);
  return getMember(info.lastInsertRowid);
}

function setStatus(id, status, note = '') {
  if (!VALID_STATUSES.includes(status)) throw new Error('Unknown status.');
  const existing = getMember(id);
  if (!existing) return null;
  stmts.updateStatus.run({ id, status, note: String(note || '').slice(0, 140) });
  stmts.addHistory.run(id, status);
  return getMember(id);
}

function updateMember(id, { name, role }) {
  const existing = getMember(id);
  if (!existing) return null;
  stmts.updateMember.run({
    id,
    name: name != null ? String(name).trim().slice(0, 80) : existing.name,
    role: role != null ? String(role).trim().slice(0, 80) : existing.role
  });
  return getMember(id);
}

function deleteMember(id) {
  return stmts.deleteMember.run(id).changes > 0;
}

function historyFor(id) {
  return stmts.historyFor.all(id);
}

function summary() {
  const base = { available: 0, busy: 0, away: 0 };
  for (const row of stmts.summary.all()) base[row.status] = row.n;
  return base;
}

function seedIfEmpty() {
  if (stmts.countMembers.get().n > 0) return;
  const seed = [
    { name: 'Priya Nandakumar', role: 'Product', status: 'available' },
    { name: 'Marcus Odell', role: 'Engineering', status: 'busy' },
    { name: 'Sofia Reyes', role: 'Design', status: 'away' },
    { name: 'Kenji Watanabe', role: 'Engineering', status: 'available' }
  ];
  for (const m of seed) createMember(m);
}

module.exports = {
  VALID_STATUSES,
  listMembers,
  getMember,
  createMember,
  setStatus,
  updateMember,
  deleteMember,
  historyFor,
  summary,
  seedIfEmpty
};
