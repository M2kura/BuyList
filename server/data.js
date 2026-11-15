// Lists and items: validation, ownership checks, CRUD.
import { db } from './db.js';
import { newId } from './auth.js';

export class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

const bad = (message) => { throw new HttpError(400, message); };
const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

function text(value, field, max, { required = false } = {}) {
  if (value === null || value === undefined) value = '';
  if (typeof value !== 'string') bad(`${field} must be text`);
  value = value.trim();
  if (required && !value) bad(`${field} is required`);
  if (value.length > max) bad(`${field} is too long (max ${max} characters)`);
  return value;
}

function links(value) {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) bad('links must be a list');
  const out = [];
  for (let raw of value) {
    if (typeof raw !== 'string') bad('Each link must be text');
    raw = raw.trim();
    if (!raw) continue;
    if (!/^[a-z][a-z0-9+.-]*:/i.test(raw)) raw = `https://${raw}`;
    let url;
    try { url = new URL(raw); } catch { bad(`Not a valid link: ${raw}`); }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') bad('Links must start with http:// or https://');
    if (url.href.length > 2000) bad('Link is too long');
    out.push(url.href);
  }
  if (out.length > 20) bad('At most 20 links per item');
  return out;
}

function price(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'string' ? Number(value.replace(',', '.').replace(/\s/g, '')) : value;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 1e12) bad('Price must be a positive number');
  return Math.round(n * 100) / 100;
}

function currency(value) {
  if (value === null || value === undefined || value === '') return 'CZK';
  if (typeof value !== 'string' || !/^[A-Za-z]{3}$/.test(value.trim())) bad('Currency must be a 3-letter code like CZK');
  return value.trim().toUpperCase();
}

function quantity(value) {
  if (value === null || value === undefined || value === '') return 1;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 100000) bad('Quantity must be a whole number, 1 or more');
  return n;
}

function deadline(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) bad('Date must be YYYY-MM-DD');
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) bad('Not a valid date');
  return value;
}

function priority(value) {
  if (value === null || value === undefined || value === '') return 1;
  const n = Number(value);
  if (![0, 1, 2].includes(n)) bad('Priority must be 0, 1 or 2');
  return n;
}

// ---------- serialisation ----------

const listOut = (row) => ({ id: row.id, name: row.name, emoji: row.emoji, createdAt: row.created_at });

const itemOut = (row) => ({
  id: row.id,
  listId: row.list_id,
  name: row.name,
  links: JSON.parse(row.links),
  price: row.price,
  currency: row.currency,
  quantity: row.quantity,
  deadline: row.deadline,
  priority: row.priority,
  note: row.note,
  boughtAt: row.bought_at,
  createdAt: row.created_at,
});

export function loadState(userId) {
  return {
    lists: db.prepare('SELECT * FROM lists WHERE user_id = ? ORDER BY created_at, rowid').all(userId).map(listOut),
    items: db.prepare('SELECT * FROM items WHERE user_id = ? ORDER BY created_at, rowid').all(userId).map(itemOut),
  };
}

// ---------- lists ----------

const ownList = (userId, id) => {
  const row = db.prepare('SELECT * FROM lists WHERE id = ? AND user_id = ?').get(String(id ?? ''), userId);
  if (!row) throw new HttpError(404, 'List not found');
  return row;
};

export function createList(userId, body = {}) {
  const row = {
    id: newId(),
    name: text(body.name, 'Name', 80, { required: true }),
    emoji: text(body.emoji, 'Emoji', 16),
    created_at: Date.now(),
  };
  db.prepare('INSERT INTO lists (id, user_id, name, emoji, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(row.id, userId, row.name, row.emoji, row.created_at);
  return listOut(row);
}

export function updateList(userId, id, body = {}) {
  const row = ownList(userId, id);
  if (has(body, 'name')) row.name = text(body.name, 'Name', 80, { required: true });
  if (has(body, 'emoji')) row.emoji = text(body.emoji, 'Emoji', 16);
  db.prepare('UPDATE lists SET name = ?, emoji = ? WHERE id = ?').run(row.name, row.emoji, row.id);
  return listOut(row);
}

export function deleteList(userId, id) {
  ownList(userId, id);
  db.prepare('DELETE FROM lists WHERE id = ? AND user_id = ?').run(id, userId);
}

// ---------- items ----------

const ownItem = (userId, id) => {
  const row = db.prepare('SELECT * FROM items WHERE id = ? AND user_id = ?').get(String(id ?? ''), userId);
  if (!row) throw new HttpError(404, 'Item not found');
  return row;
};

/** Applies the fields present in `body` onto `row` (validated). */
function applyItemFields(userId, row, body) {
  if (has(body, 'listId')) row.list_id = ownList(userId, body.listId).id;
  if (has(body, 'name')) row.name = text(body.name, 'Name', 200, { required: true });
  if (has(body, 'links')) row.links = JSON.stringify(links(body.links));
  if (has(body, 'price')) row.price = price(body.price);
  if (has(body, 'currency')) row.currency = currency(body.currency);
  if (has(body, 'quantity')) row.quantity = quantity(body.quantity);
  if (has(body, 'deadline')) row.deadline = deadline(body.deadline);
  if (has(body, 'priority')) row.priority = priority(body.priority);
  if (has(body, 'note')) row.note = text(body.note, 'Note', 5000);
  if (has(body, 'bought')) {
    if (typeof body.bought !== 'boolean') bad('bought must be true or false');
    row.bought_at = body.bought ? (row.bought_at ?? Date.now()) : null;
  }
}

export function createItem(userId, body = {}) {
  if (!has(body, 'listId')) bad('listId is required');
  if (!has(body, 'name')) bad('Name is required');
  const row = {
    id: newId(), list_id: null, name: '', links: '[]', price: null, currency: 'CZK', quantity: 1,
    deadline: null, priority: 1, note: '', bought_at: null, created_at: Date.now(),
  };
  applyItemFields(userId, row, body);
  db.prepare(`
    INSERT INTO items (id, user_id, list_id, name, links, price, currency, quantity, deadline, priority, note, bought_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(row.id, userId, row.list_id, row.name, row.links, row.price, row.currency, row.quantity,
    row.deadline, row.priority, row.note, row.bought_at, row.created_at);
  return itemOut(row);
}

export function updateItem(userId, id, body = {}) {
  const row = ownItem(userId, id);
  applyItemFields(userId, row, body);
  db.prepare(`
    UPDATE items SET list_id = ?, name = ?, links = ?, price = ?, currency = ?, quantity = ?,
      deadline = ?, priority = ?, note = ?, bought_at = ?
    WHERE id = ? AND user_id = ?
  `).run(row.list_id, row.name, row.links, row.price, row.currency, row.quantity,
    row.deadline, row.priority, row.note, row.bought_at, row.id, userId);
  return itemOut(row);
}

export function deleteItem(userId, id) {
  ownItem(userId, id);
  db.prepare('DELETE FROM items WHERE id = ? AND user_id = ?').run(id, userId);
}
