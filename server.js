const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const https = require('https');

// .env 読み込み（dotenv がある場合）
try { require('dotenv').config(); } catch (_) {}

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const DB_PATH = path.join(__dirname, 'db.json');
const LINE_NOTIFY_TOKEN = process.env.LINE_NOTIFY_TOKEN || '';
const HEARTBEAT_TIMEOUT_SEC = 60;

// ---------------------
// Kronos MT4 ファイルパス
// ---------------------
const KRONOS_MT4_FILES_PATH = process.env.KRONOS_MT4_FILES_PATH || '';
const KRONOS_STATUS_FILE = KRONOS_MT4_FILES_PATH
  ? path.join(KRONOS_MT4_FILES_PATH, 'kronos_status.json')
  : '';
const KRONOS_HEARTBEAT_FILE = KRONOS_MT4_FILES_PATH
  ? path.join(KRONOS_MT4_FILES_PATH, 'kronos_heartbeat.json')
  : '';

// ---------------------
// LINE Notify 送信
// ---------------------
function sendLineNotify(message) {
  if (!LINE_NOTIFY_TOKEN) {
    console.warn('LINE_NOTIFY_TOKEN not set, skipping alert:', message);
    return;
  }
  const postData = `message=${encodeURIComponent(message)}`;
  const options = {
    hostname: 'notify-api.line.me',
    path: '/api/notify',
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Bearer ${LINE_NOTIFY_TOKEN}`,
      'Content-Length': Buffer.byteLength(postData)
    }
  };
  const req = https.request(options, (res) => {
    if (res.statusCode !== 200) {
      console.error('LINE Notify error:', res.statusCode);
    }
  });
  req.on('error', (e) => console.error('LINE Notify request failed:', e.message));
  req.write(postData);
  req.end();
}

// ---------------------
// ハートビート監視
// ---------------------
const DOLPHIN_HEARTBEAT_FILE = process.env.DOLPHIN_MT4_FILES_PATH
  ? path.join(process.env.DOLPHIN_MT4_FILES_PATH, 'rescue_heartbeat.json')
  : '';

let dolphinAlerted = false;
let kronosAlerted = false;

function checkHeartbeat(filePath, label, alertedRef) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return alertedRef;
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const ts = new Date(data.timestamp.replace(' ', 'T')).getTime();
    const ageSec = (Date.now() - ts) / 1000;
    if (ageSec > HEARTBEAT_TIMEOUT_SEC) {
      if (!alertedRef) {
        sendLineNotify(`⚠️ ${label} ハートビート途絶（${Math.floor(ageSec)}秒経過）`);
        console.warn(`${label} heartbeat timeout: ${Math.floor(ageSec)}s`);
        return true;
      }
    } else {
      if (alertedRef) {
        console.log(`${label} heartbeat recovered`);
      }
      return false;
    }
  } catch (e) {
    console.error(`${label} heartbeat check error:`, e.message);
  }
  return alertedRef;
}

function isKronosActive() {
  try {
    const db = readDb();
    const kronos = (db.accounts || []).find(a => a.id === 'kronos');
    return kronos && kronos.active;
  } catch (_) {
    return false;
  }
}

setInterval(() => {
  // Dolphin 監視
  if (DOLPHIN_HEARTBEAT_FILE) {
    dolphinAlerted = checkHeartbeat(
      DOLPHIN_HEARTBEAT_FILE,
      'Dolphin RescueEA',
      dolphinAlerted
    );
  }
  // Kronos 監視（active=falseの場合はスキップ）
  if (KRONOS_HEARTBEAT_FILE && isKronosActive()) {
    kronosAlerted = checkHeartbeat(
      KRONOS_HEARTBEAT_FILE,
      'Kronos RescueEA',
      kronosAlerted
    );
  }
}, 15000);

// ---------------------
// Kronos ステータスファイル読み込みヘルパー
// ---------------------
function readKronosStatus() {
  if (!KRONOS_STATUS_FILE || !fs.existsSync(KRONOS_STATUS_FILE)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(KRONOS_STATUS_FILE, 'utf8'));
  } catch (e) {
    console.error('kronos_status.json read error:', e.message);
    return null;
  }
}

function readDb() {
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}

function writeDb(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

// ---------------------
// 既存 Dolphin エンドポイント
// ---------------------

// Dolphin ステータス
app.get('/api/status', (req, res) => {
  const db = readDb();
  res.json(db.status || {});
});

// Dolphin トレード一覧
app.get('/api/trades', (req, res) => {
  const db = readDb();
  res.json(db.trades || []);
});

// Dolphin 日次DD
app.get('/api/daily-dd', (req, res) => {
  const db = readDb();
  res.json(db.daily_dd || []);
});

// Dolphin ステータス更新（MQ4から受信）
app.post('/api/status', (req, res) => {
  const db = readDb();
  db.status = req.body;
  writeDb(db);
  res.json({ ok: true });
});

// Dolphin トレード更新
app.post('/api/trades', (req, res) => {
  const db = readDb();
  db.trades = req.body;
  writeDb(db);
  res.json({ ok: true });
});

// ---------------------
// マルチアカウント共通
// ---------------------

// GET /api/accounts - 全口座サマリー（オブジェクト形式）
app.get('/api/accounts', (req, res) => {
  const db = readDb();
  const dolphinStatus = db.status || {};
  const kronosStatus = readKronosStatus();
  const kronosAcct = (db.accounts || []).find(a => a.id === 'kronos') || {};

  const result = {
    dolphin: {
      name: 'DolphinEA',
      broker: 'BigBoss',
      balance: dolphinStatus.balance || null,
      equity: dolphinStatus.equity || null,
      dd_percent: dolphinStatus.dd_percent || null,
      active: true,
      last_heartbeat: dolphinStatus.timestamp || null
    },
    kronos: {
      name: kronosAcct.name || 'Kronos Gold デフォルト',
      broker: 'XM',
      balance: kronosStatus ? kronosStatus.balance : null,
      equity: kronosStatus ? kronosStatus.equity : null,
      dd_percent: kronosStatus ? kronosStatus.dd_percent : null,
      active: kronosStatus ? (kronosStatus.active || false) : false,
      last_heartbeat: kronosStatus ? kronosStatus.timestamp : null
    }
  };
  res.json(result);
});

// ---------------------
// Kronos エンドポイント
// ---------------------

// GET /api/kronos/status - kronos_status.json を直読み
app.get('/api/kronos/status', (req, res) => {
  const data = readKronosStatus();
  if (!data) {
    return res.json({ active: false, message: '未接続', timestamp: null });
  }
  // ハートビートタイムアウト判定
  try {
    const ts = new Date(data.timestamp).getTime();
    const ageSec = (Date.now() - ts) / 1000;
    if (ageSec > HEARTBEAT_TIMEOUT_SEC) {
      data.heartbeat_lost = true;
    }
  } catch (_) {
    data.heartbeat_lost = true;
  }
  res.json(data);
});

// GET /api/kronos/trades
app.get('/api/kronos/trades', (req, res) => {
  const db = readDb();
  res.json(db.kronos_trades || []);
});

// POST /api/kronos/upload - DSファイルアップロード＋パース
const upload = multer({ dest: path.join(__dirname, 'uploads') });
app.post('/api/kronos/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  try {
    const html = fs.readFileSync(req.file.path, 'utf8');
    const trades = parseDsHtml(html);

    // db.jsonに追記（重複チケットはスキップ）
    const db = readDb();
    const existing = new Set((db.kronos_trades || []).map(t => t.ticket));
    const newTrades = trades.filter(t => !existing.has(t.ticket));
    db.kronos_trades = (db.kronos_trades || []).concat(newTrades);

    // 日次統計を計算して kronos_daily_dd に追記
    const dailyStats = calcDailyStats(newTrades);
    const existingDates = new Set((db.kronos_daily_dd || []).map(d => d.date));
    for (const stat of dailyStats) {
      if (existingDates.has(stat.date)) {
        // 既存日付はマージ（加算）
        const idx = db.kronos_daily_dd.findIndex(d => d.date === stat.date);
        if (idx >= 0) {
          db.kronos_daily_dd[idx].total_profit += stat.total_profit;
          db.kronos_daily_dd[idx].trade_count += stat.trade_count;
          db.kronos_daily_dd[idx].win_count += stat.win_count;
          db.kronos_daily_dd[idx].loss_count += stat.loss_count;
        }
      } else {
        db.kronos_daily_dd.push(stat);
      }
    }
    // 日付順ソート
    db.kronos_daily_dd.sort((a, b) => a.date.localeCompare(b.date));

    writeDb(db);

    // アップロード後にテンポラリ削除
    fs.unlinkSync(req.file.path);

    res.json({
      ok: true,
      imported: newTrades.length,
      skipped: trades.length - newTrades.length,
      total: db.kronos_trades.length
    });
  } catch (e) {
    console.error('DS parse error:', e.message);
    res.status(500).json({ error: 'Parse failed: ' + e.message });
  }
});

// ---------------------
// DSパーサー
// ---------------------
function parseDsHtml(html) {
  const trades = [];
  // <tr> 行からトレード情報を抽出
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;

  while ((rowMatch = rowRegex.exec(html)) !== null) {
    const row = rowMatch[1];
    const cells = [];
    const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let cellMatch;
    while ((cellMatch = cellRegex.exec(row)) !== null) {
      cells.push(cellMatch[1].replace(/<[^>]*>/g, '').trim());
    }

    // DSの典型的なカラム配置:
    // ticket, open_time, type, lots, symbol, open_price, sl, tp, close_time, close_price, commission, taxes, swap, profit, magic
    if (cells.length < 14) continue;

    const ticket = parseInt(cells[0], 10);
    if (isNaN(ticket)) continue;

    const typeStr = cells[2].toLowerCase();
    if (typeStr !== 'buy' && typeStr !== 'sell') continue;

    const trade = {
      ticket: ticket,
      open_time: normalizeTimestamp(cells[1]),
      type: typeStr,
      lots: parseFloat(cells[3]) || 0,
      symbol: cells[4],
      open_price: parseFloat(cells[5]) || 0,
      close_time: normalizeTimestamp(cells[8]),
      close_price: parseFloat(cells[9]) || 0,
      profit: parseFloat(cells[13]) || 0,
      magic: parseInt(cells[14], 10) || 0
    };
    trades.push(trade);
  }

  return trades;
}

function normalizeTimestamp(ts) {
  if (!ts) return '';
  // "2026.03.31 12:00:00" → "2026-03-31 12:00:00"
  return ts.replace(/\./g, '-');
}

function calcDailyStats(trades) {
  const byDate = {};
  for (const t of trades) {
    const date = (t.close_time || '').substring(0, 10);
    if (!date || date.length < 10) continue;
    if (!byDate[date]) {
      byDate[date] = { date, total_profit: 0, trade_count: 0, win_count: 0, loss_count: 0 };
    }
    byDate[date].total_profit += t.profit;
    byDate[date].trade_count++;
    if (t.profit >= 0) byDate[date].win_count++;
    else byDate[date].loss_count++;
  }
  return Object.values(byDate);
}

// ---------------------
// フロントエンド配信
// ---------------------
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
