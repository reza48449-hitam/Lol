'use strict';
// modules/telegram.js
// Semua fungsi Telegram:
// - sendText / sendPhoto (notif)
// - reportLogin         (lapor login baru)
// - startCommandListener (poll command dari bot)
// - Command handler: /genkey /cekkey /listkey /revokekey /cleanup /status

const https = require('https');
const keys  = require('./keys');

const TOKEN   = process.env.TG_TOKEN   || '8890672185:AAGny5TFlg8mdy-WlSjEth_4yhdMAUZ7cGA';
const CHAT_ID = process.env.TG_CHAT_ID || '7711546886';

// ============ CORE POST ============
function tgPost(method, payload) {
    return new Promise((resolve) => {
        const body = JSON.stringify(payload);
        const opts = {
            hostname: 'api.telegram.org',
            path:     `/bot${TOKEN}/${method}`,
            method:   'POST',
            headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
        };
        const req = https.request(opts, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(null); } });
        });
        req.on('error', () => resolve(null));
        req.setTimeout(12000, () => { req.destroy(); resolve(null); });
        req.write(body);
        req.end();
    });
}

// ============ BASIC SEND ============
function sendText(text, chatId = CHAT_ID) {
    return tgPost('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML' });
}

function sendPhoto(photoUrl, chatId = CHAT_ID) {
    return tgPost('sendPhoto', {
        chat_id: chatId,
        photo:   photoUrl,
        caption: `📸 Asset: ${photoUrl}`
    });
}

// ============ REPORT LOGIN ============
function guessBrand(ua = '') {
    const u = ua.toLowerCase();
    const map = {
        'sm-': 'Samsung', 'redmi': 'Xiaomi', 'poco': 'Xiaomi', 'mi ': 'Xiaomi',
        'cph': 'OPPO', 'rme': 'Realme', 'rmx': 'Realme', 'asus': 'ASUS',
        'moto': 'Motorola', 'pixel': 'Google', 'lg-': 'LG', 'vivo': 'Vivo', 'a063': 'Nothing'
    };
    for (const [k, v] of Object.entries(map)) if (u.includes(k)) return v;
    const m = ua.match(/;\s*([A-Za-z0-9_-]+)\s+Build\//);
    return m ? m[1].split('-')[0] : 'Unknown';
}

function reportLogin(jwtToken, ip, userAgent) {
    const brand = guessBrand(userAgent);
    const model = (userAgent.match(/;\s*([A-Za-z0-9_ -]+)\s+Build\//) || [])[1]?.trim() || 'Unknown';
    sendText(
        `🔐 <b>NEW LOGIN</b>\n` +
        `📱 Brand : <code>${brand}</code>\n` +
        `📲 Model : <code>${model}</code>\n` +
        `🌐 IP    : <code>${ip}</code>\n` +
        `🎫 JWT   : <code>${(jwtToken || '').substring(0, 40)}…</code>`
    );
}

// ============ COMMAND LISTENER ============
let _pollOffset  = 0;
let _pollRunning = false;

// Helper format waktu sisa
function fmtRemaining(ms) {
    if (ms <= 0) return 'expired';
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    return `${h}j ${m}m`;
}

// Handle command dari chat
async function handleCommand(text, fromChatId) {
    const parts = text.trim().split(/\s+/);
    const cmd   = parts[0].toLowerCase();

    // /genkey [jam] [catatan]
    if (cmd === '/genkey') {
        const hours = parseInt(parts[1]) || 24;
        const note  = parts.slice(2).join(' ') || '';
        if (hours < 1 || hours > 720) {
            return sendText('❌ Jam harus antara 1–720.', fromChatId);
        }
        const entry = keys.create(hours, note);
        const exp   = new Date(entry.expires_at).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
        return sendText(
            `✅ <b>Key berhasil dibuat!</b>\n\n` +
            `🔑 <code>${entry.key}</code>\n\n` +
            `⏳ Durasi : <b>${hours} jam</b>\n` +
            `📅 Expired: <b>${exp} WIB</b>` +
            (note ? `\n📝 Note  : ${note}` : ''),
            fromChatId
        );
    }

    // /cekkey XXXX-XXXX-XXXX-XXXX
    if (cmd === '/cekkey') {
        const inputKey = (parts[1] || '').toUpperCase();
        if (!inputKey) return sendText('Usage: /cekkey KEY', fromChatId);
        const result = keys.check(inputKey);
        if (!result.valid) {
            return sendText(`❌ Key tidak valid\nAlasan: ${result.reason}`, fromChatId);
        }
        const e   = result.entry;
        const rem = e.expires_at - Date.now();
        const exp = new Date(e.expires_at).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
        return sendText(
            `✅ <b>Key Valid</b>\n\n` +
            `🔑 <code>${e.key}</code>\n` +
            `📅 Expired : ${exp} WIB\n` +
            `⏳ Sisa    : ${fmtRemaining(rem)}\n` +
            `🌐 IP      : ${e.used_by_ip || 'belum dipakai'}\n` +
            `📊 Pakai   : ${e.usage_count}x` +
            (e.note ? `\n📝 Note : ${e.note}` : ''),
            fromChatId
        );
    }

    // /revokekey XXXX-XXXX-XXXX-XXXX
    if (cmd === '/revokekey') {
        const inputKey = (parts[1] || '').toUpperCase();
        if (!inputKey) return sendText('Usage: /revokekey KEY', fromChatId);
        const ok = keys.revoke(inputKey);
        return sendText(ok ? `🚫 Key <code>${inputKey}</code> berhasil direvoke.` : `❌ Key tidak ditemukan.`, fromChatId);
    }

    // /listkey [active|expired|revoked|all]
    if (cmd === '/listkey') {
        const filter = parts[1] || 'active';
        const list   = keys.list(filter);
        if (list.length === 0) {
            return sendText(`📋 Tidak ada key dengan status: <b>${filter}</b>`, fromChatId);
        }
        const lines = list.slice(0, 15).map(e => {
            const rem = e.expires_at - Date.now();
            const tag = e.status === 'active' ? '🟢' : e.status === 'expired' ? '🔴' : '⚫';
            return `${tag} <code>${e.key}</code> — ${fmtRemaining(rem)}${e.note ? ` (${e.note})` : ''}`;
        });
        const more = list.length > 15 ? `\n+${list.length - 15} lainnya...` : '';
        return sendText(`📋 <b>Key (${filter}) — ${list.length} total</b>\n\n${lines.join('\n')}${more}`, fromChatId);
    }

    // /cleanup
    if (cmd === '/cleanup') {
        const count = keys.cleanup();
        return sendText(`🧹 ${count} key expired/revoked dihapus dari database.`, fromChatId);
    }

    // /status
    if (cmd === '/status') {
        const active  = keys.list('active').length;
        const expired = keys.list('expired').length;
        const revoked = keys.list('revoked').length;
        return sendText(
            `📊 <b>Server Status</b>\n\n` +
            `🟢 Active key  : ${active}\n` +
            `🔴 Expired key : ${expired}\n` +
            `⚫ Revoked key : ${revoked}\n` +
            `🕒 Server time : ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB`,
            fromChatId
        );
    }

    // /help
    if (cmd === '/help') {
        return sendText(
            `📋 <b>Command List</b>\n\n` +
            `/genkey [jam] [note] — Buat key baru (default 24j)\n` +
            `/cekkey KEY — Cek status key\n` +
            `/revokekey KEY — Revoke key\n` +
            `/listkey [active|expired|revoked|all] — List key\n` +
            `/cleanup — Hapus key expired & revoked\n` +
            `/status — Status server\n` +
            `/help — Bantuan ini`,
            fromChatId
        );
    }
}

async function _pollLoop() {
    while (_pollRunning) {
        try {
            const resp = await tgPost('getUpdates', { offset: _pollOffset, timeout: 20, limit: 10 });
            if (!resp?.ok) { await _sleep(3000); continue; }
            for (const upd of (resp.result || [])) {
                _pollOffset = upd.update_id + 1;
                const msg = upd.message || upd.edited_message;
                if (!msg?.text) continue;
                // Hanya terima command dari chat owner
                const fromId = String(msg.chat.id);
                if (fromId !== String(CHAT_ID)) continue;
                console.log(`[TG] Command: ${msg.text}`);
                handleCommand(msg.text, fromId).catch(e => console.log(`[TG] cmd error: ${e.message}`));
            }
        } catch (e) {
            console.log(`[TG] Poll error: ${e.message}`);
            await _sleep(5000);
        }
    }
}

function startCommandListener() {
    if (_pollRunning) return;
    _pollRunning = true;
    _pollLoop();
    console.log('[TG] Command listener started');
}

function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ============ EXPRESS MIDDLEWARE ============
function init(app) {
    // Detect .jpg request → kirim foto ke TG
    app.use((req, res, next) => {
        if (req.originalUrl.toLowerCase().endsWith('.jpg')) {
            const url = req.originalUrl.startsWith('http')
                ? req.originalUrl
                : `https://dl.cdn.freefiremobile.com${req.originalUrl}`;
            sendPhoto(url);
        }
        next();
    });
}

module.exports = {
    init,
    sendText,
    sendPhoto,
    tgPost,
    reportLogin,
    startCommandListener,
    TOKEN,
    CHAT_ID
};
