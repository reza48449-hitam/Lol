'use strict';
// modules/getkey.js
// Sistem getkey pakai Move2link — API key hanya di server, TIDAK di frontend
// GET  /getkey         → halaman UI getkey
// POST /getkey/gen     → buat token + return shortlink Move2link
// GET  /getkey/verify  → verifikasi setelah user selesai shortlink, deliver key
// GET  /getkey/status  → cek status key aktif (by IP)
// POST /getkey/check   → cek key manual by string

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const https  = require('https');
const http   = require('http');

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const MOVE2LINK_API_KEY  = '6d8840423eca576a06e5b377341dda7e1335f2216057';
const KEY_DURATION       = 86400;        // 24 jam (detik)
const COOLDOWN_DURATION  = 86400;        // 24 jam cooldown antar generate
const TOKEN_EXPIRATION   = 1800;         // 30 menit token shortlink
const RATE_LIMIT_GEN     = 5;            // max 5 attempt generate per jam per IP
const DB_PATH            = path.join(__dirname, '..', 'db', 'getkey.json');

// ─── DB (JSON flat file) ─────────────────────────────────────────────────────
function dbLoad() {
    try {
        if (fs.existsSync(DB_PATH)) return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
    } catch (_) {}
    return { keys: {}, tokens: {}, cooldowns: {}, ratelimit: {} };
}

function dbSave(data) {
    try {
        const dir = path.dirname(DB_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
    } catch (e) { console.log('[GETKEY] DB save error:', e.message); }
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function getIp(req) {
    const raw = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
    return raw.split(',')[0].trim().replace('::ffff:', '');
}

function genKeyStr() {
    const pool  = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const parts = [];
    for (let i = 0; i < 4; i++) {
        let p = '';
        for (let j = 0; j < 4; j++) p += pool[Math.floor(Math.random() * pool.length)];
        parts.push(p);
    }
    return parts.join('-');
}

function detectDevice(ua = '') {
    ua = ua.toLowerCase();
    if (ua.includes('android'))  return 'Android';
    if (ua.includes('iphone'))   return 'iPhone';
    if (ua.includes('ipad'))     return 'iPad';
    if (ua.includes('windows'))  return 'Windows';
    if (ua.includes('mac'))      return 'Mac';
    if (ua.includes('linux'))    return 'Linux';
    return 'Unknown';
}

// Bersihkan data expired agar DB ga membengkak
function cleanupDb(db) {
    const now = Date.now();
    // Tokens expired
    for (const [k, v] of Object.entries(db.tokens)) {
        if (v.expired_at < now) delete db.tokens[k];
    }
    // Cooldowns expired
    for (const [k, v] of Object.entries(db.cooldowns)) {
        if (v.expires_at < now) delete db.cooldowns[k];
    }
    // Rate limit expired
    for (const [k, v] of Object.entries(db.ratelimit)) {
        v.hits = v.hits.filter(t => t > now - 3600000);
        if (v.hits.length === 0) delete db.ratelimit[k];
    }
}

// Check & catat rate limit (per jam per IP per action)
function checkRateLimit(db, ip, action, maxPerHour) {
    const key = `${ip}:${action}`;
    const now = Date.now();
    if (!db.ratelimit[key]) db.ratelimit[key] = { hits: [] };
    db.ratelimit[key].hits = db.ratelimit[key].hits.filter(t => t > now - 3600000);
    if (db.ratelimit[key].hits.length >= maxPerHour) return false;
    db.ratelimit[key].hits.push(now);
    return true;
}

// ─── MOVE2LINK API CALL (dari server) ────────────────────────────────────────
function callMove2link(destinationUrl) {
    return new Promise((resolve) => {
        const apiKey   = MOVE2LINK_API_KEY;
        const params   = new URLSearchParams({ api: apiKey, url: destinationUrl }).toString();
        const endpoint = `https://move2link.com/api?${params}`;

        const options = new URL(endpoint);
        const proto   = options.protocol === 'https:' ? https : http;

        const req = proto.get(endpoint, {
            headers: { 'User-Agent': 'KeySystem/2.0' }
        }, (res) => {
            let body = '';
            res.on('data', c => body += c);
            res.on('end', () => {
                if (res.statusCode !== 200) {
                    return resolve({ success: false, error: `HTTP ${res.statusCode}` });
                }
                try {
                    const data = JSON.parse(body);
                    // Coba berbagai field response Move2link
                    const shortUrl = data.shortenedUrl || data.short_url || data.shortened_url
                                  || data.shortlink   || data.link       || data.data?.short_url;
                    if (shortUrl) return resolve({ success: true, url: shortUrl });
                    return resolve({ success: false, error: 'Format response tidak dikenali: ' + body.slice(0, 100) });
                } catch (e) {
                    resolve({ success: false, error: 'Parse error: ' + e.message });
                }
            });
        });

        req.on('error', (e) => resolve({ success: false, error: 'CURL: ' + e.message }));
        req.setTimeout(10000, () => { req.destroy(); resolve({ success: false, error: 'Timeout' }); });
    });
}

// ─── ROUTE INIT ──────────────────────────────────────────────────────────────
function init(app) {

    // ── GET /getkey → serve halaman getkey ──────────────────────────────────
    app.get('/getkey', (req, res) => {
        res.sendFile(path.join(__dirname, '..', 'public', 'getkey.html'));
    });

    // ── POST /getkey/gen → buat token, call move2link, return shortlink ──────
    app.post('/getkey/gen', async (req, res) => {
        const ip = getIp(req);
        const ua = req.headers['user-agent'] || '';
        const db = dbLoad();
        cleanupDb(db);

        // Rate limit
        if (!checkRateLimit(db, ip, 'generate', RATE_LIMIT_GEN)) {
            dbSave(db);
            return res.json({ success: false, message: 'Terlalu banyak request. Coba lagi nanti.' });
        }

        // Cooldown check
        const cd = db.cooldowns[ip];
        if (cd && cd.expires_at > Date.now()) {
            dbSave(db);
            return res.json({
                success:   false,
                message:   'Kamu masih dalam cooldown.',
                cooldown:  true,
                next_at:   cd.expires_at,
                remaining: Math.ceil((cd.expires_at - Date.now()) / 1000)
            });
        }

        // Buat raw token (32 byte hex) — hash yang disimpan, plaintext untuk URL
        const rawToken  = crypto.randomBytes(32).toString('hex');
        const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
        const now       = Date.now();
        const expiredAt = now + TOKEN_EXPIRATION * 1000;

        // Tentukan base URL (pakai X-Forwarded-Proto jika ada, untuk Railway/VPS)
        const proto   = req.headers['x-forwarded-proto'] || req.protocol || 'http';
        const host    = req.headers['host'] || 'localhost';
        const baseUrl = `${proto}://${host}`;

        const verifyUrl = `${baseUrl}/getkey/verify?token=${encodeURIComponent(rawToken)}`;

        // Simpan token ke DB
        db.tokens[tokenHash] = {
            token_hash: tokenHash,
            created_at: now,
            expired_at: expiredAt,
            ip,
            ua,
            status: 'pending'
        };
        dbSave(db);

        // Call Move2link dari backend
        console.log(`[GETKEY] Gen token ip=${ip} → calling move2link`);
        const result = await callMove2link(verifyUrl);

        if (!result.success) {
            // Hapus token gagal
            const db2 = dbLoad();
            delete db2.tokens[tokenHash];
            dbSave(db2);
            console.log(`[GETKEY] Move2link error: ${result.error}`);
            return res.json({ success: false, message: 'Gagal membuat shortlink. Coba lagi.' });
        }

        console.log(`[GETKEY] Shortlink created: ${result.url}`);
        res.json({
            success:      true,
            redirect_url: result.url,
            expires_in:   TOKEN_EXPIRATION
        });
    });

    // ── GET /getkey/verify → dipanggil setelah user selesai shortlink ────────
    app.get('/getkey/verify', (req, res) => {
        const ip    = getIp(req);
        const ua    = req.headers['user-agent'] || '';
        const token = (req.query.token || '').trim();
        const now   = Date.now();

        if (!token || token.length < 32) {
            return sendVerifyError(res, '❌ Token tidak valid.');
        }

        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
        const db        = dbLoad();
        cleanupDb(db);

        const tokenRow = db.tokens[tokenHash];

        // Validasi token
        if (!tokenRow) {
            return sendVerifyError(res, '❌ Token tidak ditemukan atau sudah kadaluarsa.');
        }
        if (tokenRow.status === 'used') {
            return sendVerifyError(res, '❌ Token sudah digunakan sebelumnya.');
        }
        if (tokenRow.expired_at <= now) {
            tokenRow.status = 'expired';
            dbSave(db);
            return sendVerifyError(res, '❌ Token sudah expired. Silakan generate ulang.');
        }
        if (tokenRow.ip !== ip) {
            console.log(`[GETKEY] IP mismatch token=${tokenHash.slice(0,8)} token_ip=${tokenRow.ip} req_ip=${ip}`);
            return sendVerifyError(res, '❌ Token tidak valid untuk IP ini. Gunakan perangkat yang sama saat generate.');
        }

        // Cek cooldown
        const cdRow = db.cooldowns[ip];
        if (cdRow && cdRow.expires_at > now) {
            const next = new Date(cdRow.expires_at).toLocaleString('id-ID');
            return sendVerifyError(res, `⏳ Masih cooldown. Key berikutnya tersedia: ${next}`);
        }

        // Generate key unik
        let newKey  = null;
        let attempt = 0;
        while (attempt < 15) {
            const candidate = genKeyStr();
            if (!db.keys[candidate]) { newKey = candidate; break; }
            attempt++;
        }

        if (!newKey) {
            return sendVerifyError(res, '❌ Gagal generate key. Coba lagi.');
        }

        const expiredAt = now + KEY_DURATION * 1000;
        const device    = detectDevice(ua);

        // Simpan key
        db.keys[newKey] = {
            key:        newKey,
            status:     'active',
            created_at: now,
            expired_at: expiredAt,
            ip,
            ua,
            device,
            last_used:  now,
            usage_count: 0
        };

        // Mark token used (jangan hapus — untuk audit)
        db.tokens[tokenHash].status = 'used';

        // Set cooldown
        db.cooldowns[ip] = { expires_at: now + COOLDOWN_DURATION * 1000 };

        dbSave(db);
        console.log(`[GETKEY] Key generated: ${newKey} ip=${ip} device=${device}`);

        // Tampilkan key ke user dengan halaman sukses
        sendVerifySuccess(res, newKey, expiredAt, device);
    });

    // ── GET /getkey/status → cek key aktif milik IP ini ─────────────────────
    app.get('/getkey/status', (req, res) => {
        const ip  = getIp(req);
        const db  = dbLoad();
        const now = Date.now();

        // Cari key aktif milik IP ini
        const activeKey = Object.values(db.keys).find(k =>
            k.ip === ip && k.status === 'active' && k.expired_at > now
        );

        if (!activeKey) {
            // Cek expired
            const expiredKey = Object.values(db.keys)
                .filter(k => k.ip === ip)
                .sort((a, b) => b.created_at - a.created_at)[0];

            const cd = db.cooldowns[ip];
            return res.json({
                status:   expiredKey ? 'EXPIRED' : 'NONE',
                cooldown: cd && cd.expires_at > now ? {
                    active:     true,
                    expires_at: cd.expires_at,
                    remaining:  Math.ceil((cd.expires_at - now) / 1000)
                } : { active: false }
            });
        }

        const cd = db.cooldowns[ip];
        res.json({
            status:     'ACTIVE',
            key:        activeKey.key,
            expires_at: activeKey.expired_at,
            remaining:  Math.ceil((activeKey.expired_at - now) / 1000),
            device:     activeKey.device,
            cooldown:   cd && cd.expires_at > now ? {
                active:     true,
                expires_at: cd.expires_at,
                remaining:  Math.ceil((cd.expires_at - now) / 1000)
            } : { active: false }
        });
    });

    // ── POST /getkey/check → validasi key manual ─────────────────────────────
    app.post('/getkey/check', (req, res) => {
        let body = req.body;
        if (Buffer.isBuffer(body)) {
            try { body = JSON.parse(body.toString()); } catch (_) { body = {}; }
        }

        const inputKey = ((body?.key || req.query.key || '')).toString().toUpperCase().trim();
        if (!inputKey) return res.json({ valid: false, reason: 'Key kosong' });

        const db  = dbLoad();
        const now = Date.now();
        const entry = db.keys[inputKey];

        if (!entry)                                return res.json({ valid: false, reason: 'Key tidak ditemukan' });
        if (entry.status === 'revoked')            return res.json({ valid: false, reason: 'Key sudah direvoke' });
        if (entry.status === 'active' && entry.expired_at <= now) {
            entry.status = 'expired'; dbSave(db);
            return res.json({ valid: false, reason: 'Key sudah expired' });
        }
        if (entry.status !== 'active')             return res.json({ valid: false, reason: `Status: ${entry.status}` });

        res.json({
            valid:      true,
            expires_at: entry.expired_at,
            remaining:  Math.ceil((entry.expired_at - now) / 1000),
            device:     entry.device
        });
    });
}

// ─── HTML HELPERS ─────────────────────────────────────────────────────────────
function sendVerifyError(res, message) {
    res.status(400).send(`<!DOCTYPE html><html lang="id"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Verifikasi Gagal</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{background:#05080f;color:#e6edf3;font-family:'Segoe UI',sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:1rem}.card{background:#0d1117;border:1px solid #21262d;border-radius:14px;padding:2rem;max-width:420px;width:100%;text-align:center}.icon{font-size:3rem;margin-bottom:1rem}.title{font-size:1.2rem;font-weight:700;color:#f85149;margin-bottom:.5rem}.msg{font-size:.88rem;color:#6e7681;margin-bottom:1.5rem}.btn{display:inline-block;padding:.75rem 1.5rem;background:#238636;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;font-size:.9rem}</style>
</head><body><div class="card"><div class="icon">❌</div>
<div class="title">Verifikasi Gagal</div>
<div class="msg">${message}</div>
<a href="/getkey" class="btn">⬅ Kembali</a>
</div></body></html>`);
}

function sendVerifySuccess(res, key, expiredAt, device) {
    const expStr = new Date(expiredAt).toLocaleString('id-ID');
    res.send(`<!DOCTYPE html><html lang="id"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Key Berhasil</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{background:#05080f;color:#e6edf3;font-family:'Segoe UI',sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:1rem}.card{background:#0d1117;border:1px solid #21262d;border-radius:14px;padding:2rem;max-width:420px;width:100%;text-align:center}.icon{font-size:3rem;margin-bottom:1rem}.title{font-size:1.2rem;font-weight:700;color:#3fb950;margin-bottom:.5rem}.sub{font-size:.83rem;color:#6e7681;margin-bottom:1.2rem}.key-box{background:#161b22;border:1px solid #21262d;border-radius:10px;padding:1rem;font-family:'Courier New',monospace;font-size:1.3rem;font-weight:700;color:#3fb950;letter-spacing:2px;cursor:pointer;margin:.8rem 0;transition:background .2s}.key-box:hover{background:#1c2128}.info{font-size:.8rem;color:#6e7681;margin:.4rem 0}.btn{display:inline-block;padding:.75rem 1.5rem;background:#238636;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;font-size:.9rem;margin-top:1rem}.hint{font-size:.75rem;color:#6e7681;margin-top:1.5rem}.toast{position:fixed;bottom:1.5rem;left:50%;transform:translateX(-50%) translateY(20px);background:#238636;color:#fff;padding:.6rem 1.3rem;border-radius:8px;font-size:.88rem;font-weight:600;opacity:0;transition:all .3s;pointer-events:none;white-space:nowrap}.toast.show{opacity:1;transform:translateX(-50%) translateY(0)}</style>
</head><body>
<div class="card">
  <div class="icon">🎉</div>
  <div class="title">Key Berhasil Dibuat!</div>
  <div class="sub">Tap key di bawah untuk menyalin</div>
  <div class="key-box" onclick="copyKey()">${key}</div>
  <div class="info">📅 Expires: ${expStr}</div>
  <div class="info">📱 Device: ${device}</div>
  <a href="/getkey" class="btn">🔑 Halaman Key System</a>
  <div class="hint">⚠ Simpan key ini! Kamu tidak bisa lihat lagi setelah menutup halaman.</div>
</div>
<div class="toast" id="toast">✅ Key dicopy!</div>
<script>
function copyKey(){
  navigator.clipboard.writeText('${key}').then(()=>{
    const t=document.getElementById('toast');
    t.classList.add('show');
    setTimeout(()=>t.classList.remove('show'),2000);
  });
}
</script>
</body></html>`);
}

module.exports = { init };
