import './styles.css';
import { api, ApiError } from './api.js';

const BASE = import.meta.env.BASE_URL;
const CURRENCIES = ['CZK', 'EUR', 'USD', 'GBP', 'PLN'];
const EMOJIS = ['🛒', '🛋️', '🎁', '🎄', '🛠️', '🎧', '🎨', '📚', '👕', '💻', '🏠', '🌱', '🍳', '🚲', '✈️', '💡'];
const SORTS = [['added', 'Added'], ['due', 'Due'], ['price', 'Price'], ['priority', 'Priority']];

const state = {
  user: null,
  lists: [],
  items: [],
  currentId: null,
  sort: load('sort', 'added'),
  showBought: load('showBought', false),
};

// ---------- tiny DOM helper ----------

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v; // only ever used with the static icon strings below
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const svg = (path, extra = '') =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${extra}>${path}</svg>`;
const ICON = {
  check: svg('<path d="M20 6 9 17l-5-5"/>', 'stroke-width="3"'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  more: svg('<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>', 'fill="currentColor"'),
  x: svg('<path d="M18 6 6 18M6 6l12 12"/>'),
  link: svg('<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>'),
  cal: svg('<rect x="3" y="4.5" width="18" height="17" rx="3"/><path d="M3 10h18M8 2.5v4M16 2.5v4"/>'),
  chev: svg('<path d="m9 6 6 6-6 6"/>'),
  logout: svg('<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H3"/>'),
  key: svg('<circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 9.3-9.3M16 7l3 3M14 9l2 2"/>'),
  note: svg('<path d="M4 6h16M4 12h16M4 18h10"/>'),
};
const icon = (name) => h('span', { html: ICON[name], style: 'display:contents' });

function load(key, fallback) {
  try { const v = localStorage.getItem(`buylist.${key}`); return v === null ? fallback : JSON.parse(v); } catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(`buylist.${key}`, JSON.stringify(value)); } catch { /* private mode */ }
}

function toast(message) {
  document.querySelector('.toast')?.remove();
  const el = h('div', { class: 'toast', role: 'status' }, message);
  document.body.append(el);
  setTimeout(() => el.remove(), 3200);
}

async function run(fn) {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) { state.user = null; renderLogin(); return undefined; }
    toast(err.message || 'Something went wrong');
    throw err;
  }
}

// ---------- formatting ----------

const money = (amount, currency) => {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: amount % 1 ? 2 : 0 }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
};

function totals(items) {
  const byCur = new Map();
  for (const it of items) {
    if (it.price == null) continue;
    byCur.set(it.currency, (byCur.get(it.currency) ?? 0) + it.price * it.quantity);
  }
  return [...byCur].map(([cur, sum]) => money(sum, cur)).join(' + ');
}

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const daysUntil = (date) => Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${todayStr()}T00:00:00Z`)) / 864e5);

function deadlineChip(date, done) {
  const days = daysUntil(date);
  const exact = new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: days > 300 || days < -300 ? 'numeric' : undefined });
  let label;
  let cls = '';
  if (done) label = exact;
  else if (days < 0) { label = `${-days}d overdue`; cls = 'overdue'; }
  else if (days === 0) { label = 'Today'; cls = 'overdue'; }
  else if (days === 1) { label = 'Tomorrow'; cls = 'soon'; }
  else if (days <= 7) { label = `In ${days} days`; cls = 'soon'; }
  else label = `By ${exact}`;
  return h('span', { class: `chip ${cls}`, title: `Buy by ${exact}` }, icon('cal'), label);
}

const hostname = (url) => {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
};

// ---------- data ----------

const currentList = () => state.lists.find((l) => l.id === state.currentId) ?? null;
const itemsOf = (listId) => state.items.filter((i) => i.listId === listId);

function sortItems(items) {
  const by = {
    added: (a, b) => a.createdAt - b.createdAt,
    due: (a, b) => (a.deadline ?? '9999').localeCompare(b.deadline ?? '9999') || a.createdAt - b.createdAt,
    price: (a, b) => (b.price ?? -1) * b.quantity - (a.price ?? -1) * a.quantity,
    priority: (a, b) => b.priority - a.priority || (a.deadline ?? '9999').localeCompare(b.deadline ?? '9999'),
  }[state.sort] ?? (() => 0);
  return [...items].sort(by);
}

function selectList(id) {
  state.currentId = id;
  if (id) history.replaceState(null, '', `#${id}`);
  render();
}

async function refresh() {
  const data = await api.get('/state');
  state.user = data.user;
  state.lists = data.lists;
  state.items = data.items;
  const fromHash = location.hash.slice(1);
  if (!state.lists.some((l) => l.id === state.currentId)) {
    state.currentId = state.lists.some((l) => l.id === fromHash) ? fromHash : (state.lists[0]?.id ?? null);
  }
}

async function createList(name, emoji = '') {
  const list = await run(() => api.post('/lists', { name, emoji }));
  state.lists.push(list);
  selectList(list.id);
  setTimeout(() => document.querySelector('.add-row input')?.focus(), 0);
}

async function saveItem(id, patch) {
  const updated = await run(() => api.patch(`/items/${id}`, patch));
  state.items = state.items.map((i) => (i.id === id ? updated : i));
  render();
}

// ---------- login ----------

function renderLogin() {
  const error = h('p', { class: 'error' });
  const form = h('form', {
    async onsubmit(e) {
      e.preventDefault();
      error.textContent = '';
      const fd = new FormData(form);
      try {
        await api.post('/auth/login', { username: fd.get('username'), password: fd.get('password') });
        await refresh();
        render();
      } catch (err) {
        error.textContent = err.message;
      }
    },
  },
  h('div', { class: 'brand' }, h('img', { src: `${BASE}favicon.svg`, alt: '' }), 'BuyList'),
  h('label', { class: 'field' }, h('span', {}, 'Username'), h('input', { class: 'input', name: 'username', autocomplete: 'username', required: true, autofocus: true })),
  h('label', { class: 'field' }, h('span', {}, 'Password'), h('input', { class: 'input', name: 'password', type: 'password', autocomplete: 'current-password', required: true })),
  error,
  h('button', { class: 'btn btn-primary', type: 'submit' }, 'Log in'));
  document.getElementById('app').replaceChildren(h('main', { class: 'login' }, form));
  form.querySelector('input').focus();
}

// ---------- app ----------

function accountBar(extraClass = '') {
  return h('div', { class: `account ${extraClass}` },
    h('span', { class: 'who' }, state.user.username),
    h('button', { class: 'icon-btn', title: 'Change password', onclick: openPasswordDialog }, icon('key')),
    h('button', {
      class: 'icon-btn', title: 'Log out',
      async onclick() { await api.post('/auth/logout'); state.user = null; renderLogin(); },
    }, icon('logout')));
}

function sidebar() {
  return h('aside', { class: 'sidebar' },
    h('div', { class: 'sidebar-top' },
      h('div', { class: 'brand' }, h('img', { src: `${BASE}favicon.svg`, alt: '' }), 'BuyList'),
      accountBar()),
    h('nav', { class: 'lists-nav', 'aria-label': 'Lists' },
      state.lists.length ? h('div', { class: 'nav-label' }, 'Lists') : null,
      state.lists.map((list) => {
        const open = itemsOf(list.id).filter((i) => !i.boughtAt).length;
        return h('button', {
          class: 'list-link', 'aria-current': String(list.id === state.currentId),
          onclick: () => selectList(list.id),
        },
        h('span', { class: 'emoji' }, list.emoji || '•'),
        h('span', { class: 'name' }, list.name),
        open ? h('span', { class: 'count' }, open) : null);
      }),
      h('button', { class: 'list-link new', onclick: () => openListDialog() },
        h('span', { class: 'emoji' }, '+'), h('span', { class: 'name' }, 'New list'))),
    accountBar('desktop'));
}

function itemRow(item) {
  const done = Boolean(item.boughtAt);
  const meta = h('div', { class: 'meta' },
    item.price != null
      ? h('span', { class: 'price' }, money(item.price * item.quantity, item.currency),
        item.quantity > 1 ? h('span', { style: 'font-weight:400;color:var(--muted)' }, ` · ${money(item.price, item.currency)} each`) : null)
      : null,
    item.deadline ? deadlineChip(item.deadline, done) : null,
    item.links.map((url) => h('a', {
      class: 'chip', href: url, target: '_blank', rel: 'noopener noreferrer', title: url,
      onclick: (e) => e.stopPropagation(),
    }, icon('link'), hostname(url))),
    item.note ? h('span', { class: 'note', title: item.note }, item.note.split('\n')[0]) : null);

  return h('li', {
    class: `item${done ? ' done' : ''}`,
    tabindex: '0',
    onclick: () => openItemDialog(item),
    onkeydown: (e) => { if (e.key === 'Enter' && e.target === e.currentTarget) openItemDialog(item); },
  },
  h('button', {
    class: 'check', 'aria-label': done ? 'Mark as not bought' : 'Mark as bought', html: ICON.check,
    onclick: (e) => { e.stopPropagation(); saveItem(item.id, { bought: !done }); },
  }),
  h('div', { class: 'item-body' },
    h('div', { class: 'item-name' },
      item.priority === 2 && !done ? h('span', { class: 'prio', title: 'High priority' }) : null,
      h('span', {}, item.name),
      item.quantity > 1 ? h('span', { class: 'qty' }, `×${item.quantity}`) : null),
    meta));
}

function emptyState() {
  return h('div', { class: 'empty' },
    h('div', { class: 'big' }, '🛍️'),
    h('h2', {}, 'Start a list'),
    h('p', {}, 'Group the things you want to buy, by store, project or occasion.'),
    h('div', { class: 'suggestions' },
      [['🛋️', 'IKEA'], ['🛠️', 'Studio tools'], ['🎄', 'Xmas gifts']].map(([emoji, name]) =>
        h('button', { class: 'btn', onclick: () => createList(name, emoji) }, `${emoji} ${name}`)),
      h('button', { class: 'btn btn-primary', onclick: () => openListDialog() }, icon('plus'), 'New list')));
}

function listView(list) {
  const all = itemsOf(list.id);
  const open = sortItems(all.filter((i) => !i.boughtAt));
  const bought = all.filter((i) => i.boughtAt).sort((a, b) => b.boughtAt - a.boughtAt);
  const remaining = totals(open);

  const input = h('input', { placeholder: 'Add something to buy…', 'aria-label': 'New item name', maxlength: '200', enterkeyhint: 'done' });
  const addForm = h('form', {
    class: 'add-row',
    async onsubmit(e) {
      e.preventDefault();
      const name = input.value.trim();
      if (!name) return;
      input.value = '';
      const item = await run(() => api.post('/items', { listId: list.id, name }));
      state.items.push(item);
      render();
      document.querySelector('.add-row input')?.focus();
    },
  }, h('span', { class: 'plus', html: ICON.plus }), input,
  h('button', { class: 'btn btn-primary', type: 'submit' }, 'Add'));

  return h('div', { class: 'content' },
    h('div', { class: 'list-head' },
      h('h1', { class: 'list-title' }, list.emoji ? h('span', { class: 'emoji' }, list.emoji) : null, list.name),
      h('button', { class: 'icon-btn', title: 'Edit list', 'aria-label': 'Edit list', html: ICON.more, onclick: () => openListDialog(list) })),
    h('p', { class: 'summary' },
      open.length ? [h('strong', {}, open.length), ` to buy`] : 'Nothing left to buy',
      remaining ? [' · ', h('strong', {}, remaining), ' left'] : null,
      bought.length ? ` · ${bought.length} bought` : null),
    addForm,
    open.length > 1 ? h('div', { class: 'toolbar' },
      h('span', { class: 'label' }, 'Sort'),
      h('div', { class: 'segmented', role: 'group', 'aria-label': 'Sort items' },
        SORTS.map(([key, label]) => h('button', {
          'aria-pressed': String(state.sort === key),
          onclick: () => { state.sort = key; save('sort', key); render(); },
        }, label)))) : h('div', { style: 'height:18px' }),
    open.length ? h('ul', { class: 'items' }, open.map(itemRow))
      : all.length ? null : h('div', { class: 'empty', style: 'padding:32px 0' }, h('p', {}, 'Only the name is required. Click an item to add links, price or a date.')),
    bought.length ? [
      h('button', {
        class: 'bought-toggle', 'aria-expanded': String(state.showBought),
        onclick: () => { state.showBought = !state.showBought; save('showBought', state.showBought); render(); },
      }, icon('chev'), `Bought (${bought.length})`),
      state.showBought ? h('ul', { class: 'items' }, bought.map(itemRow)) : null,
    ] : null);
}

function render() {
  if (!state.user) return renderLogin();
  const list = currentList();
  const app = document.getElementById('app');
  const scrollY = window.scrollY;
  app.replaceChildren(h('div', { class: 'shell' },
    sidebar(),
    h('main', { class: 'main' }, list ? listView(list) : h('div', { class: 'content' }, emptyState()))));
  window.scrollTo(0, scrollY);
  document.title = list ? `${list.name} · BuyList` : 'BuyList';
  document.querySelector('.list-link[aria-current="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

// ---------- dialogs ----------

function dialog(title, body, foot, onsubmit) {
  const dlg = h('dialog', {},
    h('form', {
      method: 'dialog',
      async onsubmit(e) {
        e.preventDefault();
        try { await onsubmit(e.currentTarget); dlg.close(); } catch { /* toast shown; keep open */ }
      },
    },
    h('div', { class: 'dlg-head' }, h('h2', {}, title),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close', html: ICON.x, onclick: () => dlg.close() })),
    h('div', { class: 'dlg-body' }, body),
    h('div', { class: 'dlg-foot' }, foot)));
  dlg.addEventListener('close', () => dlg.remove());
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); }); // backdrop
  document.body.append(dlg);
  dlg.showModal();
  return dlg;
}

function openListDialog(list = null) {
  let emoji = list?.emoji ?? '';
  const nameInput = h('input', { class: 'input name-input', name: 'name', required: true, maxlength: '80', value: list?.name ?? '', placeholder: 'e.g. IKEA' });
  const custom = h('input', { class: 'input', style: 'width:72px;text-align:center', maxlength: '16', value: emoji, placeholder: '🙂', 'aria-label': 'Custom emoji',
    oninput: (e) => { emoji = e.target.value.trim(); paint(); } });
  const picks = h('div', { class: 'emoji-picks' }, EMOJIS.map((em) => h('button', {
    type: 'button', 'data-emoji': em,
    onclick: () => { emoji = emoji === em ? '' : em; custom.value = emoji; paint(); },
  }, em)));
  const paint = () => picks.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.emoji === emoji)));
  paint();

  const foot = [
    list ? h('button', {
      type: 'button', class: 'btn btn-danger',
      async onclick() {
        const n = itemsOf(list.id).length;
        if (!confirm(`Delete "${list.name}"${n ? ` and its ${n} item${n > 1 ? 's' : ''}` : ''}?`)) return;
        await run(() => api.del(`/lists/${list.id}`));
        state.lists = state.lists.filter((l) => l.id !== list.id);
        state.items = state.items.filter((i) => i.listId !== list.id);
        state.currentId = state.lists[0]?.id ?? null;
        dlg.close();
        render();
      },
    }, 'Delete list') : null,
    h('span', { class: 'spacer' }),
    h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => dlg.close() }, 'Cancel'),
    h('button', { type: 'submit', class: 'btn btn-primary' }, list ? 'Save' : 'Create list'),
  ];

  const dlg = dialog(list ? 'Edit list' : 'New list', [
    h('label', { class: 'field' }, h('span', {}, 'Name'), nameInput),
    h('div', { class: 'field' }, h('span', {}, 'Icon'),
      h('div', { style: 'display:flex;gap:10px;align-items:flex-start' }, picks, custom)),
  ], foot, async () => {
    const name = nameInput.value.trim();
    if (list) {
      const updated = await run(() => api.patch(`/lists/${list.id}`, { name, emoji }));
      state.lists = state.lists.map((l) => (l.id === list.id ? updated : l));
      render();
    } else {
      await createList(name, emoji);
    }
  });
  nameInput.focus();
}

function openItemDialog(item) {
  const f = (name, props = {}) => h('input', { class: 'input', name, ...props });
  const name = f('name', { required: true, maxlength: '200', value: item.name, class: 'input name-input' });

  const linksBox = h('div', { class: 'links' });
  const addLinkRow = (value = '') => {
    const row = h('div', { class: 'link-row' },
      f('link', { type: 'url', inputmode: 'url', value, placeholder: 'https://…', autocomplete: 'off' }),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Remove link', html: ICON.x, onclick: () => row.remove() }));
    linksBox.append(row);
    return row;
  };
  item.links.forEach((l) => addLinkRow(l));
  if (!item.links.length) addLinkRow();

  const price = f('price', { inputmode: 'decimal', value: item.price ?? '', placeholder: '0', autocomplete: 'off' });
  const currency = h('select', { class: 'input', name: 'currency' },
    [...new Set([...CURRENCIES, item.currency])].map((c) => h('option', { value: c, selected: c === item.currency }, c)));
  const quantity = f('quantity', { type: 'number', min: '1', step: '1', value: item.quantity, inputmode: 'numeric' });
  const deadline = f('deadline', { type: 'date', value: item.deadline ?? '' });

  let priority = item.priority;
  const prio = h('div', { class: 'segmented', role: 'group', 'aria-label': 'Priority' },
    [[0, 'Low'], [1, 'Normal'], [2, 'High']].map(([v, label]) => h('button', {
      type: 'button', 'data-v': v, 'aria-pressed': String(v === priority),
      onclick: (e) => { priority = v; prio.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget))); },
    }, label)));

  const listSel = h('select', { class: 'input', name: 'list' },
    state.lists.map((l) => h('option', { value: l.id, selected: l.id === item.listId }, `${l.emoji ? `${l.emoji} ` : ''}${l.name}`)));
  const note = h('textarea', { class: 'input', name: 'note', maxlength: '5000', placeholder: 'Size, colour, model, gift idea for…' }, item.note);
  const bought = h('input', { type: 'checkbox', checked: Boolean(item.boughtAt) });

  const foot = [
    h('button', {
      type: 'button', class: 'btn btn-danger',
      async onclick() {
        if (!confirm(`Delete "${item.name}"?`)) return;
        await run(() => api.del(`/items/${item.id}`));
        state.items = state.items.filter((i) => i.id !== item.id);
        dlg.close();
        render();
      },
    }, 'Delete'),
    h('span', { class: 'spacer' }),
    h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => dlg.close() }, 'Cancel'),
    h('button', { type: 'submit', class: 'btn btn-primary' }, 'Save'),
  ];

  const dlg = dialog('Item', [
    h('label', { class: 'field' }, h('span', {}, 'Name'), name),
    h('div', { class: 'field' }, h('span', {}, 'Where to buy'), linksBox,
      h('button', { type: 'button', class: 'btn btn-ghost add-link', onclick: () => addLinkRow().querySelector('input').focus() }, icon('plus'), 'Add link')),
    h('div', { class: 'row', style: '--cols:3' },
      h('label', { class: 'field' }, h('span', {}, 'Price (each)'), price),
      h('label', { class: 'field' }, h('span', {}, 'Currency'), currency),
      h('label', { class: 'field' }, h('span', {}, 'Quantity'), quantity)),
    h('div', { class: 'row wrap-sm' },
      h('label', { class: 'field' }, h('span', {}, 'Buy by'), deadline),
      h('div', { class: 'field' }, h('span', {}, 'Priority'), prio)),
    state.lists.length > 1 ? h('label', { class: 'field' }, h('span', {}, 'List'), listSel) : null,
    h('label', { class: 'field' }, h('span', {}, 'Note'), note),
    h('label', { class: 'switch' }, bought, 'Bought'),
  ], foot, async () => {
    await saveItem(item.id, {
      name: name.value,
      links: [...linksBox.querySelectorAll('input')].map((i) => i.value).filter((v) => v.trim()),
      price: price.value.trim() === '' ? null : price.value,
      currency: currency.value,
      quantity: quantity.value || 1,
      deadline: deadline.value || null,
      priority,
      listId: listSel.value || item.listId,
      note: note.value,
      bought: bought.checked,
    });
  });
}

function openPasswordDialog() {
  const cur = h('input', { class: 'input', type: 'password', autocomplete: 'current-password', required: true });
  const next = h('input', { class: 'input', type: 'password', autocomplete: 'new-password', required: true, minlength: '8' });
  dialog('Change password', [
    h('label', { class: 'field' }, h('span', {}, 'Current password'), cur),
    h('label', { class: 'field' }, h('span', {}, 'New password (8+ characters)'), next),
  ], [
    h('span', { class: 'spacer' }),
    h('button', { type: 'submit', class: 'btn btn-primary' }, 'Change password'),
  ], async () => {
    await run(() => api.post('/account/password', { currentPassword: cur.value, newPassword: next.value }));
    toast('Password changed');
  });
  cur.focus();
}

// ---------- boot ----------

window.addEventListener('hashchange', () => {
  const id = location.hash.slice(1);
  if (id !== state.currentId && state.lists.some((l) => l.id === id)) { state.currentId = id; render(); }
});

(async () => {
  try {
    await refresh();
    render();
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) renderLogin();
    else document.getElementById('app').replaceChildren(h('main', { class: 'login' }, h('p', { class: 'error' }, `Could not load: ${err.message}`)));
  }
})();
