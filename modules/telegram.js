'use strict';
// modules/telegram.js

const https = require('https');
const keys  = require('./keys');

const TOKEN   = process.env.TG_TOKEN   || '8614102278:AAEU5S0VR4J7q1CRu6G5taIF-jifiB4zDMo';
const CHAT_ID = process.env.TG_CHAT_ID || '7711546886';

// ============================================================
// CORE HTTP POST
// ============================================================
function tgPost(method, payload) {
    return new Promise((resolve) => {
        const body = JSON.stringify(payload);
        const opts = {
            hostname : 'api.telegram.org',
            path     : `/bot${TOKEN}/${method}`,
            method   : 'POST',
            headers  : {
                'Content-Type'   : 'application/json',
                'Content-Length' : Buffer.byteLength(body)
            },
            timeout  : 15000
        };
        const req = https.request(opts, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); }
                catch { resolve(null); }
            });
        });
        req.on('timeout', () => { req.destroy(); resolve(null); });
        req.on('error',   () => resolve(null));
        req.write(body);
        req.end();
    });
}

// ============================================================
// BASIC SEND
// ============================================================
function sendText(text, chatId = CHAT_ID, extra = {}) {
    return tgPost('sendMessage', {
        chat_id    : chatId,
        text,
        parse_mode : 'HTML',
        ...extra
    });
}

function sendPhoto(photoUrl, chatId = CHAT_ID) {
    return tgPost('sendPhoto', {
        chat_id : chatId,
        photo   : photoUrl,
        caption : `📸 Asset: ${photoUrl}`
    });
}

// ============================================================
// INLINE KEYBOARD HELPERS
// ============================================================

/** Buat tombol main menu */
function mainMenuKeyboard() {
    return {
        inline_keyboard: [
            [
                { text: '📊 Status Server', callback_data: 'status' },
                { text: '📋 List Key',       callback_data: 'list_active' }
            ],
            [
                { text: '➕ Gen Key 24j',   callback_data: 'genkey_24' },
                { text: '➕ Gen Key 72j',   callback_data: 'genkey_72' }
            ],
            [
                { text: '🧹 Cleanup',        callback_data: 'cleanup' },
                { text: '❓ Help',            callback_data: 'help' }
            ]
        ]
    };
}

/** Kirim pesan dengan tombol main menu */
function sendWithMainMenu(text, chatId) {
    return sendText(text, chatId, { reply_markup: mainMenuKeyboard() });
}

// ============================================================
// REPORT LOGIN
// ============================================================
function guessBrand(ua = '') {
    const u   = ua.toLowerCase();
    const map = {
        'sm-': 'Samsung', 'redmi': 'Xiaomi', 'poco': 'Xiaomi', 'mi ': 'Xiaomi',
        'cph': 'OPPO', 'rme': 'Realme', 'rmx': 'Realme', 'asus': 'ASUS',
        'moto': 'Motorola', 'pixel': 'Google', 'lg-': 'LG', 'vivo': 'Vivo',
        'a063': 'Nothing'
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

// ============================================================
// FORMAT HELPERS
// ============================================================
function fmtRemaining(ms) {
    if (ms <= 0) return 'expired';
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    return `${h}j ${m}m`;
}

// ============================================================
// COMMAND + CALLBACK HANDLER
// ============================================================

/**
 * Jawab callback_query (dari tombol inline).
 * Wajib di-answer agar loading spinner di Telegram hilang.
 */
function answerCallback(callbackQueryId, text = '') {
    return tgPost('answerCallbackQuery', {
        callback_query_id : callbackQueryId,
        text              : text,
        show_alert        : false
    });
}

/**
 * Edit pesan sebelumnya (setelah tombol ditekan)
 * kalau gagal (pesan sudah terhapus dll), kirim pesan baru.
 */
async function editOrSend(chatId, messageId, text, extra = {}) {
    const payload = {
        chat_id    : chatId,
        message_id : messageId,
        text,
        parse_mode : 'HTML',
        ...extra
    };
    const r = await tgPost('editMessageText', payload);
    // Kalau edit gagal (misal pesan tidak bisa diedit), kirim baru
    if (!r || !r.ok) {
        return sendText(text, chatId, extra);
    }
    return r;
}

// Handle teks command (/genkey, /cekkey, dst)
async function handleCommand(text, fromChatId) {
    const parts = text.trim().split(/\s+/);
    const cmd   = parts[0].toLowerCase().split('@')[0]; // buang @botname

    // /start atau /menu
    if (cmd === '/start' || cmd === '/menu') {
        return sendWithMainMenu(
            `👋 <b>Selamat datang!</b>\n\nPilih menu di bawah:`,
            fromChatId
        );
    }

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
            `⏳ Durasi  : <b>${hours} jam</b>\n` +
            `📅 Expired : <b>${exp} WIB</b>` +
            (note ? `\n📝 Note   : ${note}` : ''),
            fromChatId,
            {
                reply_markup: {
                    inline_keyboard: [[
                        { text: '📋 List Key', callback_data: 'list_active' },
                        { text: '🏠 Menu',     callback_data: 'menu' }
                    ]]
                }
            }
        );
    }

    // /cekkey XXXX-XXXX-XXXX-XXXX
    if (cmd === '/cekkey') {
        const inputKey = (parts[1] || '').toUpperCase();
        if (!inputKey) return sendText('Usage: /cekkey KEY', fromChatId);
        const result = keys.check(inputKey);
        if (!result.valid) {
            return sendText(
                `❌ <b>Key tidak valid</b>\nAlasan: ${result.reason}`,
                fromChatId,
                { reply_markup: { inline_keyboard: [[{ text: '🏠 Menu', callback_data: 'menu' }]] } }
            );
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
            fromChatId,
            {
                reply_markup: {
                    inline_keyboard: [[
                        { text: `🚫 Revoke Key`, callback_data: `revoke_${e.key}` },
                        { text: '🏠 Menu',       callback_data: 'menu' }
                    ]]
                }
            }
        );
    }

    // /revokekey XXXX-XXXX-XXXX-XXXX
    if (cmd === '/revokekey') {
        const inputKey = (parts[1] || '').toUpperCase();
        if (!inputKey) return sendText('Usage: /revokekey KEY', fromChatId);
        const ok = keys.revoke(inputKey);
        return sendText(
            ok
                ? `🚫 Key <code>${inputKey}</code> berhasil direvoke.`
                : `❌ Key tidak ditemukan.`,
            fromChatId,
            { reply_markup: { inline_keyboard: [[{ text: '🏠 Menu', callback_data: 'menu' }]] } }
        );
    }

    // /listkey [active|expired|revoked|all]
    if (cmd === '/listkey') {
        const filter = parts[1] || 'active';
        const list   = keys.list(filter);
        if (list.length === 0) {
            return sendText(
                `📋 Tidak ada key dengan status: <b>${filter}</b>`,
                fromChatId,
                {
                    reply_markup: {
                        inline_keyboard: [[
                            { text: '🏠 Menu', callback_data: 'menu' }
                        ]]
                    }
                }
            );
        }
        const lines = list.slice(0, 15).map(e => {
            const rem = e.expires_at - Date.now();
            const tag = e.status === 'active' ? '🟢' : e.status === 'expired' ? '🔴' : '⚫';
            return `${tag} <code>${e.key}</code> — ${fmtRemaining(rem)}${e.note ? ` (${e.note})` : ''}`;
        });
        const more = list.length > 15 ? `\n+${list.length - 15} lainnya...` : '';
        return sendText(
            `📋 <b>Key (${filter}) — ${list.length} total</b>\n\n${lines.join('\n')}${more}`,
            fromChatId,
            {
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '🟢 Active',  callback_data: 'list_active'  },
                            { text: '🔴 Expired', callback_data: 'list_expired' },
                            { text: '⚫ Revoked', callback_data: 'list_revoked' }
                        ],
                        [
                            { text: '🏠 Menu', callback_data: 'menu' }
                        ]
                    ]
                }
            }
        );
    }

    // /cleanup
    if (cmd === '/cleanup') {
        const count = keys.cleanup();
        return sendText(
            `🧹 <b>${count}</b> key expired/revoked dihapus dari database.`,
            fromChatId,
            { reply_markup: { inline_keyboard: [[{ text: '🏠 Menu', callback_data: 'menu' }]] } }
        );
    }

    // /status
    if (cmd === '/status') {
        const active  = keys.list('active').length;
        const expired = keys.list('expired').length;
        const revoked = keys.list('revoked').length;
        return sendText(
            `📊 <b>Server Status</b>\n\n` +
            `🟢 Active key  : <b>${active}</b>\n` +
            `🔴 Expired key : <b>${expired}</b>\n` +
            `⚫ Revoked key : <b>${revoked}</b>\n` +
            `🕒 Server time : ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB`,
            fromChatId,
            { reply_markup: { inline_keyboard: [[{ text: '🏠 Menu', callback_data: 'menu' }]] } }
        );
    }

    // /help
    if (cmd === '/help') {
        return sendWithMainMenu(
            `📋 <b>Command List</b>\n\n` +
            `/genkey [jam] [note] — Buat key (default 24j)\n` +
            `/cekkey KEY — Cek status key\n` +
            `/revokekey KEY — Revoke key\n` +
            `/listkey [active|expired|revoked|all]\n` +
            `/cleanup — Hapus key expired & revoked\n` +
            `/status — Status server\n` +
            `/menu — Tampilkan menu utama`,
            fromChatId
        );
    }
}

// Handle callback_query (tombol inline ditekan)
async function handleCallbackQuery(cbq) {
    const data      = cbq.data || '';
    const fromId    = String(cbq.message?.chat?.id || cbq.from?.id || '');
    const msgId     = cbq.message?.message_id;

    // Hanya owner
    if (fromId !== String(CHAT_ID)) {
        await answerCallback(cbq.id, '⛔ Tidak diizinkan.');
        return;
    }

    await answerCallback(cbq.id); // acknowledge dulu

    // Menu utama
    if (data === 'menu') {
        return editOrSend(fromId, msgId,
            `👇 <b>Menu Utama</b>\nPilih aksi:`,
            { reply_markup: mainMenuKeyboard() }
        );
    }

    // Status
    if (data === 'status') {
        const active  = keys.list('active').length;
        const expired = keys.list('expired').length;
        const revoked = keys.list('revoked').length;
        return editOrSend(fromId, msgId,
            `📊 <b>Server Status</b>\n\n` +
            `🟢 Active key  : <b>${active}</b>\n` +
            `🔴 Expired key : <b>${expired}</b>\n` +
            `⚫ Revoked key : <b>${revoked}</b>\n` +
            `🕒 ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB`,
            { reply_markup: { inline_keyboard: [[{ text: '🏠 Menu', callback_data: 'menu' }]] } }
        );
    }

    // Gen key dari tombol
    if (data === 'genkey_24' || data === 'genkey_72') {
        const hours = data === 'genkey_72' ? 72 : 24;
        const entry = keys.create(hours, '');
        const exp   = new Date(entry.expires_at).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
        return editOrSend(fromId, msgId,
            `✅ <b>Key berhasil dibuat!</b>\n\n` +
            `🔑 <code>${entry.key}</code>\n\n` +
            `⏳ Durasi  : <b>${hours} jam</b>\n` +
            `📅 Expired : <b>${exp} WIB</b>`,
            {
                reply_markup: {
                    inline_keyboard: [[
                        { text: '📋 List Key', callback_data: 'list_active' },
                        { text: '🏠 Menu',     callback_data: 'menu' }
                    ]]
                }
            }
        );
    }

    // List key (filter)
    if (data.startsWith('list_')) {
        const filter = data.replace('list_', ''); // active | expired | revoked
        const list   = keys.list(filter);
        let msg;
        if (list.length === 0) {
            msg = `📋 Tidak ada key dengan status: <b>${filter}</b>`;
        } else {
            const lines = list.slice(0, 15).map(e => {
                const rem = e.expires_at - Date.now();
                const tag = e.status === 'active' ? '🟢' : e.status === 'expired' ? '🔴' : '⚫';
                return `${tag} <code>${e.key}</code> — ${fmtRemaining(rem)}${e.note ? ` (${e.note})` : ''}`;
            });
            const more = list.length > 15 ? `\n+${list.length - 15} lainnya...` : '';
            msg = `📋 <b>Key (${filter}) — ${list.length} total</b>\n\n${lines.join('\n')}${more}`;
        }
        return editOrSend(fromId, msgId, msg, {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '🟢 Active',  callback_data: 'list_active'  },
                        { text: '🔴 Expired', callback_data: 'list_expired' },
                        { text: '⚫ Revoked', callback_data: 'list_revoked' }
                    ],
                    [{ text: '🏠 Menu', callback_data: 'menu' }]
                ]
            }
        });
    }

    // Cleanup
    if (data === 'cleanup') {
        const count = keys.cleanup();
        return editOrSend(fromId, msgId,
            `🧹 <b>${count}</b> key expired/revoked dihapus.`,
            { reply_markup: { inline_keyboard: [[{ text: '🏠 Menu', callback_data: 'menu' }]] } }
        );
    }

    // Help
    if (data === 'help') {
        return editOrSend(fromId, msgId,
            `📋 <b>Command List</b>\n\n` +
            `/genkey [jam] [note] — Buat key (default 24j)\n` +
            `/cekkey KEY — Cek status key\n` +
            `/revokekey KEY — Revoke key\n` +
            `/listkey [active|expired|revoked|all]\n` +
            `/cleanup — Hapus key expired & revoked\n` +
            `/status — Status server\n` +
            `/menu — Menu utama`,
            { reply_markup: { inline_keyboard: [[{ text: '🏠 Menu', callback_data: 'menu' }]] } }
        );
    }

    // Revoke dari tombol: revoke_XXXX-XXXX-XXXX-XXXX
    if (data.startsWith('revoke_')) {
        const inputKey = data.replace('revoke_', '').toUpperCase();
        const ok = keys.revoke(inputKey);
        return editOrSend(fromId, msgId,
            ok
                ? `🚫 Key <code>${inputKey}</code> berhasil direvoke.`
                : `❌ Key tidak ditemukan.`,
            { reply_markup: { inline_keyboard: [[{ text: '🏠 Menu', callback_data: 'menu' }]] } }
        );
    }
}

// ============================================================
// POLL LOOP
// ============================================================
let _pollOffset  = 0;
let _pollRunning = false;

async function _pollLoop() {
    while (_pollRunning) {
        try {
            const resp = await tgPost('getUpdates', {
                offset  : _pollOffset,
                timeout : 20,
                limit   : 10
            });

            if (!resp?.ok) {
                // Kalau error 409 conflict (ada instance lain), tunggu lebih lama
                const errCode = resp?.error_code;
                if (errCode === 409) {
                    console.log('[TG] Conflict 409 — ada instance lain yg polling. Tunggu 30s...');
                    await _sleep(30000);
                } else {
                    await _sleep(3000);
                }
                continue;
            }

            for (const upd of (resp.result || [])) {
                _pollOffset = upd.update_id + 1;

                // Handle callback_query (tombol inline)
                if (upd.callback_query) {
                    const cb     = upd.callback_query;
                    const fromId = String(cb.from?.id || '');
                    if (fromId === String(CHAT_ID)) {
                        console.log(`[TG] Callback: ${cb.data}`);
                        handleCallbackQuery(cb).catch(e =>
                            console.log(`[TG] callback error: ${e.message}`)
                        );
                    } else {
                        // Jawab tapi abaikan
                        answerCallback(cb.id, '⛔').catch(() => {});
                    }
                    continue;
                }

                // Handle message / edited_message
                const msg = upd.message || upd.edited_message;
                if (!msg?.text) continue;

                const fromId = String(msg.chat.id);
                if (fromId !== String(CHAT_ID)) continue; // Hanya owner

                console.log(`[TG] Command: ${msg.text}`);
                handleCommand(msg.text, fromId).catch(e =>
                    console.log(`[TG] cmd error: ${e.message}`)
                );
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
    _pollLoop().catch(e => {
        // Kalau loop crash total, restart setelah 10 detik
        console.log(`[TG] Poll loop crashed: ${e.message}. Restart 10s...`);
        _pollRunning = false;
        setTimeout(startCommandListener, 10000);
    });
    console.log('[TG] Command listener started');
}

function stopCommandListener() {
    _pollRunning = false;
}

function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ============================================================
// EXPRESS MIDDLEWARE
// ============================================================
function init(app) {
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
    stopCommandListener,
    TOKEN,
    CHAT_ID
};
