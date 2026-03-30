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
// 新規: マルチアカウント共通
// ---------------------

// GET /api/accounts - 全口座サマリー返却
app.get('/api/accounts', (req, res) => {
  const db = readDb();
  const accounts = (db.accounts || []).map(acct => {
    // Dolphin の場合は既存 status から残高等を付与
    if (acct.id === 'dolphin') {
      const s = db.status || {};
      return {
        ...acct,
        balance: s.balance || null,
        equity: s.equity || null,
        dd_percent: s.dd_percent || null,
        last_update: s.timestamp || null
      };
    }
    // Kronos の場合は kronos_status から付与
    if (acct.id === 'kronos') {
      const s = db.kronos_status || {};
      return {
        ...acct,
        balance: s.balance || null,
        equity: s.equity || null,
        dd_percent: s.dd_percent || null,
        last_update: s.timestamp || null
      };
    }
    return acct;
  });
  res.json(accounts);
});

// ---------------------
// 新規: Kronos エンドポイント
// ---------------------

// GET /api/kronos/status - kronos_status.json を直読み
app.get('/api/kronos/status', (req, res) => {
  if (!KRONOS_STATUS_FILE || !fs.existsSync(KRONOS_STATUS_FILE)) {
    return res.json({ active: false, message: '未接続', timestamp: null });
  }
  try {
    const data = JSON.parse(fs.readFileSync(KRONOS_STATUS_FILE, 'utf8'));
    res.json(data);
  } catch (e) {
    console.error('kronos_status.json read error:', e.message);
    res.json({ active: false, message: '未接続', timestamp: null });
  }
});

// GET /api/kronos/trades
app.get('/api/kronos/trades', (req, res) => {
  const db = readDb();
  res.json(db.kronos_trades || []);
});

// POST /api/kronos/upload - DSファイルアップロード受付
const upload = multer({ dest: path.join(__dirname, 'uploads') });
app.post('/api/kronos/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  // パース処理は Phase 2 以降で実装
  res.json({
    ok: true,
    message: 'File received (parse not yet implemented)',
    filename: req.file.originalname,
    size: req.file.size
  });
});

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
