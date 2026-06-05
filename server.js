const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

const db = new Database(path.join(dataDir, 'tracker.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS state (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    who TEXT NOT NULL,
    name TEXT NOT NULL,
    points INTEGER NOT NULL,
    freq TEXT NOT NULL,
    days TEXT,
    cancellable INTEGER DEFAULT 0,
    icon TEXT DEFAULT 'star',
    sort_order INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS daily_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    who TEXT NOT NULL,
    task_id TEXT NOT NULL,
    status TEXT NOT NULL,
    UNIQUE(date, who, task_id)
  );

  CREATE TABLE IF NOT EXISTS scores (
    who TEXT PRIMARY KEY,
    points INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS shop_items (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    cost INTEGER NOT NULL,
    emoji TEXT DEFAULT '🎁',
    sort_order INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS shop_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    who TEXT NOT NULL,
    item_id TEXT NOT NULL,
    item_name TEXT NOT NULL,
    cost INTEGER NOT NULL,
    status TEXT DEFAULT 'pending',
    created_at TEXT NOT NULL
  );
`);

const initScore = db.prepare('INSERT OR IGNORE INTO scores (who, points) VALUES (?, 0)');
initScore.run('vova');
initScore.run('alisa');

const defaultTasks = [
  { id: 'v1', who: 'vova', name: 'Чтение + читательский дневник', points: 50, freq: 'daily', days: null, cancellable: 0, icon: 'book', sort_order: 1 },
  { id: 'v2', who: 'vova', name: 'Письмо (мин. 5 предложений)', points: 20, freq: 'chosen_days', days: '1,2', cancellable: 0, icon: 'pencil', sort_order: 2 },
  { id: 'v3', who: 'vova', name: 'Сходить за водой', points: 20, freq: 'daily', days: null, cancellable: 1, icon: 'droplet', sort_order: 3 },
  { id: 'v4', who: 'vova', name: 'Одежда сложена в шкафу', points: 20, freq: 'daily', days: null, cancellable: 0, icon: 'shirt', sort_order: 4 },
  { id: 'a1', who: 'alisa', name: 'Чтение + читательский дневник', points: 50, freq: 'daily', days: null, cancellable: 0, icon: 'book', sort_order: 1 },
  { id: 'a2', who: 'alisa', name: 'Письмо (мин. 3 предложения)', points: 20, freq: 'chosen_days', days: '1,2', cancellable: 0, icon: 'pencil', sort_order: 2 },
  { id: 'a3', who: 'alisa', name: 'Одежда сложена в шкафу', points: 20, freq: 'daily', days: null, cancellable: 0, icon: 'shirt', sort_order: 3 },
  { id: 'a4', who: 'alisa', name: 'Обувь расставлена в коридоре', points: 20, freq: 'daily', days: null, cancellable: 1, icon: 'shoe', sort_order: 4 },
];

const insertTask = db.prepare(`INSERT OR IGNORE INTO tasks (id,who,name,points,freq,days,cancellable,icon,sort_order) VALUES (@id,@who,@name,@points,@freq,@days,@cancellable,@icon,@sort_order)`);
for (const t of defaultTasks) insertTask.run(t);

const defaultShop = [
  { id: 's1', name: 'Мороженое', cost: 100, emoji: '🍦', sort_order: 1 },
  { id: 's2', name: 'Поход в кино', cost: 500, emoji: '🎬', sort_order: 2 },
  { id: 's3', name: 'Час дополнительного экранного времени', cost: 150, emoji: '📱', sort_order: 3 },
];
const insertShop = db.prepare(`INSERT OR IGNORE INTO shop_items (id,name,cost,emoji,sort_order) VALUES (@id,@name,@cost,@emoji,@sort_order)`);
for (const s of defaultShop) insertShop.run(s);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function isTaskActiveOnDate(task, dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  const dow = d.getDay();
  if (task.freq === 'daily') return true;
  if (task.freq === 'chosen_days') {
    const days = (task.days || '').split(',').map(Number);
    return days.includes(dow);
  }
  if (task.freq === 'weekly2') return dow === 1 || dow === 2;
  if (task.freq === 'weekly3') return dow === 1 || dow === 2 || dow === 3;
  return true;
}

function getWeekStart(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  const dow = d.getDay();
  const diff = (dow === 0 ? 6 : dow - 1);
  d.setDate(d.getDate() - diff);
  return d.toISOString().slice(0, 10);
}

function getWeekDates(dateStr) {
  const mon = new Date(getWeekStart(dateStr) + 'T12:00:00');
  const dates = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(mon);
    d.setDate(mon.getDate() + i);
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

app.get('/api/state/:who/:date', (req, res) => {
  const { who, date } = req.params;
  const tasks = db.prepare('SELECT * FROM tasks WHERE who = ? ORDER BY sort_order').all(who);
  const score = db.prepare('SELECT points FROM scores WHERE who = ?').get(who);
  const todayTasks = tasks.filter(t => isTaskActiveOnDate(t, date));
  const records = db.prepare('SELECT task_id, status FROM daily_records WHERE date = ? AND who = ?').all(date, who);
  const recMap = {};
  for (const r of records) recMap[r.task_id] = r.status;

  const weekDates = getWeekDates(date);
  const weekData = {};
  for (const wd of weekDates) {
    const recs = db.prepare('SELECT task_id, status FROM daily_records WHERE date = ? AND who = ?').all(wd, who);
    const rm = {};
    for (const r of recs) rm[r.task_id] = r.status;
    const dayTasks = tasks.filter(t => isTaskActiveOnDate(t, wd));
    const allDone = dayTasks.every(t => rm[t.id] === 'approved' || rm[t.id] === 'cancelled');
    weekData[wd] = { allDone, tasks: dayTasks.map(t => ({ id: t.id, status: rm[t.id] || 'pending' })) };
  }

  const weekBonusKey = 'weekbonus:' + who + ':' + getWeekStart(date);
  const bonusRow = db.prepare('SELECT value FROM state WHERE key = ?').get(weekBonusKey);

  const shopItems = db.prepare('SELECT * FROM shop_items ORDER BY sort_order').all();
  const myRequests = db.prepare("SELECT * FROM shop_requests WHERE who = ? AND status = 'pending' ORDER BY created_at DESC").all(who);

  res.json({
    tasks: todayTasks,
    records: recMap,
    score: score ? score.points : 0,
    weekDates,
    weekData,
    weekBonusGiven: !!bonusRow,
    shopItems,
    myRequests,
  });
});

app.post('/api/check', (req, res) => {
  const { who, taskId, date } = req.body;
  const existing = db.prepare('SELECT status FROM daily_records WHERE date=? AND who=? AND task_id=?').get(date, who, taskId);
  if (existing && existing.status === 'checked') {
    db.prepare('DELETE FROM daily_records WHERE date=? AND who=? AND task_id=?').run(date, who, taskId);
  } else if (!existing) {
    db.prepare('INSERT INTO daily_records (date,who,task_id,status) VALUES (?,?,?,?)').run(date, who, taskId, 'checked');
  }
  res.json({ ok: true });
});

app.get('/api/parent/:date', (req, res) => {
  const { date } = req.params;
  const result = {};
  for (const who of ['vova', 'alisa']) {
    const tasks = db.prepare('SELECT * FROM tasks WHERE who = ? ORDER BY sort_order').all(who);
    const score = db.prepare('SELECT points FROM scores WHERE who = ?').get(who);
    const todayTasks = tasks.filter(t => isTaskActiveOnDate(t, date));
    const records = db.prepare('SELECT task_id, status FROM daily_records WHERE date = ? AND who = ?').all(date, who);
    const recMap = {};
    for (const r of records) recMap[r.task_id] = r.status;

    const weekDates = getWeekDates(date);
    const weekBonusKey = 'weekbonus:' + who + ':' + getWeekStart(date);
    const bonusRow = db.prepare('SELECT value FROM state WHERE key = ?').get(weekBonusKey);

    let weekAllDone = true;
    for (const wd of weekDates) {
      const recs = db.prepare('SELECT task_id, status FROM daily_records WHERE date = ? AND who = ?').all(wd, who);
      const rm = {};
      for (const r of recs) rm[r.task_id] = r.status;
      const dayTasks = tasks.filter(t => isTaskActiveOnDate(t, wd));
      for (const t of dayTasks) {
        if (rm[t.id] !== 'approved' && rm[t.id] !== 'cancelled') { weekAllDone = false; break; }
      }
      if (!weekAllDone) break;
    }

    result[who] = {
      tasks: todayTasks,
      allTasks: tasks,
      records: recMap,
      score: score ? score.points : 0,
      weekAllDone,
      weekBonusGiven: !!bonusRow,
    };
  }

  const shopItems = db.prepare('SELECT * FROM shop_items ORDER BY sort_order').all();
  const shopRequests = db.prepare("SELECT * FROM shop_requests WHERE status = 'pending' ORDER BY created_at DESC").all();

  res.json({ children: result, shopItems, shopRequests });
});

app.post('/api/approve', (req, res) => {
  const { who, taskId, date, points } = req.body;
  db.prepare('INSERT OR REPLACE INTO daily_records (date,who,task_id,status) VALUES (?,?,?,?)').run(date, who, taskId, 'approved');
  db.prepare('UPDATE scores SET points = points + ? WHERE who = ?').run(points, who);
  res.json({ ok: true });
});

app.post('/api/cancel-task', (req, res) => {
  const { who, taskId, date } = req.body;
  db.prepare('INSERT OR REPLACE INTO daily_records (date,who,task_id,status) VALUES (?,?,?,?)').run(date, who, taskId, 'cancelled');
  res.json({ ok: true });
});

app.post('/api/restore-task', (req, res) => {
  const { who, taskId, date } = req.body;
  db.prepare('DELETE FROM daily_records WHERE date=? AND who=? AND task_id=?').run(date, who, taskId);
  res.json({ ok: true });
});

app.post('/api/week-bonus', (req, res) => {
  const { who, date } = req.body;
  const weekStart = getWeekStart(date);
  const key = 'weekbonus:' + who + ':' + weekStart;
  const existing = db.prepare('SELECT value FROM state WHERE key = ?').get(key);
  if (!existing) {
    db.prepare('INSERT INTO state (key,value) VALUES (?,?)').run(key, '1');
    db.prepare('UPDATE scores SET points = points + 100 WHERE who = ?').run(who);
  }
  res.json({ ok: true });
});

app.post('/api/spend', (req, res) => {
  const { who, amount } = req.body;
  const score = db.prepare('SELECT points FROM scores WHERE who = ?').get(who);
  if (!score || score.points < amount) return res.json({ ok: false, error: 'Недостаточно баллов' });
  db.prepare('UPDATE scores SET points = points - ? WHERE who = ?').run(amount, who);
  res.json({ ok: true });
});

app.post('/api/tasks', (req, res) => {
  const { who, name, points, freq, days, cancellable, icon } = req.body;
  const id = 'custom_' + Date.now();
  const maxOrder = db.prepare('SELECT MAX(sort_order) as m FROM tasks WHERE who = ?').get(who);
  const order = (maxOrder.m || 0) + 1;
  db.prepare('INSERT INTO tasks (id,who,name,points,freq,days,cancellable,icon,sort_order) VALUES (?,?,?,?,?,?,?,?,?)').run(id, who, name, points, freq, days || null, cancellable ? 1 : 0, icon || 'star', order);
  res.json({ ok: true, id });
});

app.delete('/api/tasks/:id', (req, res) => {
  db.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.get('/api/shop', (req, res) => {
  const items = db.prepare('SELECT * FROM shop_items ORDER BY sort_order').all();
  res.json(items);
});

app.post('/api/shop', (req, res) => {
  const { name, cost, emoji } = req.body;
  const id = 'shop_' + Date.now();
  const maxOrder = db.prepare('SELECT MAX(sort_order) as m FROM shop_items').get();
  const order = (maxOrder.m || 0) + 1;
  db.prepare('INSERT INTO shop_items (id,name,cost,emoji,sort_order) VALUES (?,?,?,?,?)').run(id, name, cost, emoji || '🎁', order);
  res.json({ ok: true, id });
});

app.put('/api/shop/:id', (req, res) => {
  const { name, cost, emoji } = req.body;
  db.prepare('UPDATE shop_items SET name=?, cost=?, emoji=? WHERE id=?').run(name, cost, emoji || '🎁', req.params.id);
  res.json({ ok: true });
});

app.delete('/api/shop/:id', (req, res) => {
  db.prepare('DELETE FROM shop_items WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.post('/api/shop/request', (req, res) => {
  const { who, itemId } = req.body;
  const item = db.prepare('SELECT * FROM shop_items WHERE id = ?').get(itemId);
  if (!item) return res.json({ ok: false, error: 'Приз не найден' });
  const score = db.prepare('SELECT points FROM scores WHERE who = ?').get(who);
  if (!score || score.points < item.cost) return res.json({ ok: false, error: 'Недостаточно баллов' });
  const existing = db.prepare("SELECT id FROM shop_requests WHERE who=? AND item_id=? AND status='pending'").get(who, itemId);
  if (existing) return res.json({ ok: false, error: 'Запрос уже отправлен' });
  db.prepare('INSERT INTO shop_requests (who,item_id,item_name,cost,status,created_at) VALUES (?,?,?,?,?,?)').run(who, itemId, item.name, item.cost, 'pending', new Date().toISOString());
  res.json({ ok: true });
});

app.post('/api/shop/approve-request', (req, res) => {
  const { requestId } = req.body;
  const req2 = db.prepare('SELECT * FROM shop_requests WHERE id = ?').get(requestId);
  if (!req2) return res.json({ ok: false });
  const score = db.prepare('SELECT points FROM scores WHERE who = ?').get(req2.who);
  if (!score || score.points < req2.cost) return res.json({ ok: false, error: 'Недостаточно баллов' });
  db.prepare('UPDATE shop_requests SET status=? WHERE id=?').run('approved', requestId);
  db.prepare('UPDATE scores SET points = points - ? WHERE who = ?').run(req2.cost, req2.who);
  res.json({ ok: true });
});

app.post('/api/shop/reject-request', (req, res) => {
  const { requestId } = req.body;
  db.prepare('UPDATE shop_requests SET status=? WHERE id=?').run('rejected', requestId);
  res.json({ ok: true });
});

app.listen(PORT, () => console.log('Tracker running on port ' + PORT));
