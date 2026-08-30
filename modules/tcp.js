'use strict';

// ============================================================
//  modules/tcp.js — Per-User TCP Bot Session Manager
//  Versi  : 1.0.0
//  Desain : Event-driven, 1 user = 1 lightweight session
//           Tidak ada proses/worker terpisah per user.
//           Semua isolasi dilakukan di level objek JS.
// ============================================================

const net    = require('net');
const crypto = require('crypto');

// ============================================================
//  BOT CONFIG — ambil dari gamevar agar tidak hardcode
// ============================================================
const { buildGamevarLines } = require('../gamevar');

function parseBotConfig() {
    const lines  = buildGamevarLines('');
    const result = {};
    for (const line of lines) {
        const parts = line.split(',');
        if (parts.length >= 4) {
            result[parts[0]] = parts[3];
        }
    }
    return result;
}

// Cache config; di-rebuild saat dibutuhkan
let _cachedBotCfg     = null;
let _cachedBotCfgTime = 0;
const BOT_CFG_TTL_MS  = 60_000; // re-parse tiap 60 detik

function getBotCfg() {
    const now = Date.now();
    if (!_cachedBotCfg || (now - _cachedBotCfgTime) > BOT_CFG_TTL_MS) {
        _cachedBotCfg     = parseBotConfig();
        _cachedBotCfgTime = now;
    }
    return _cachedBotCfg;
}

// ============================================================
//  KONSTANTA
// ============================================================
const MAX_SESSIONS     = 50;            // batas maksimum session aktif
const IDLE_TIMEOUT_MS  = 10 * 60_000;  // 10 menit tanpa aktivitas → cleanup
const RECONNECT_DELAYS = [2, 5, 10, 30, 60]; // detik, exponential-like backoff
const MAX_RETRIES      = RECONNECT_DELAYS.length;
const READ_BUF_LIMIT   = 64 * 1024;    // 64 KB max per baca

// Packet type constants (dipakai saat decode nanti)
const PT_CHAT_IN       = '1200';
const PT_ONLINE_IN     = '0500';

// ============================================================
//  PROTOBUF HELPER (minimal, tanpa library tambahan)
//  Sesuaikan dengan wire-format yang sudah dipakai di proxy.js
// ============================================================

function readVarintFromBuf(buf, offset) {
    let result = 0n;
    let shift  = 0n;
    while (offset < buf.length) {
        const b = BigInt(buf[offset++]);
        result |= (b & 0x7fn) << shift;
        if ((b & 0x80n) === 0n) break;
        shift += 7n;
    }
    return { value: result, next: offset };
}

function encodeVarint(value) {
    value = BigInt(value);
    const bytes = [];
    while (value > 0x7fn) {
        bytes.push(Number((value & 0x7fn) | 0x80n));
        value >>= 7n;
    }
    bytes.push(Number(value));
    return Buffer.from(bytes);
}

function encodeField(fieldNum, data) {
    const tag    = encodeVarint((BigInt(fieldNum) << 3n) | 2n);
    const length = encodeVarint(data.length);
    return Buffer.concat([tag, length, data]);
}

function encodeVarintField(fieldNum, value) {
    const tag = encodeVarint((BigInt(fieldNum) << 3n) | 0n);
    return Buffer.concat([tag, encodeVarint(value)]);
}

function encodeProto(fields) {
    const parts = [];
    for (const [field, value] of Object.entries(fields)) {
        const fn = Number(field);
        if (typeof value === 'number' || typeof value === 'bigint') {
            parts.push(encodeVarintField(fn, value));
        } else if (typeof value === 'string') {
            parts.push(encodeField(fn, Buffer.from(value, 'utf8')));
        } else if (Buffer.isBuffer(value)) {
            parts.push(encodeField(fn, value));
        } else if (typeof value === 'object' && !Array.isArray(value)) {
            parts.push(encodeField(fn, encodeProto(value)));
        }
    }
    return Buffer.concat(parts);
}

// AES-CBC encrypt/decrypt (key & iv adalah Buffer)
function aesEncrypt(hex, key, iv) {
    const cipher  = crypto.createCipheriv('aes-128-cbc', key, iv);
    const data    = Buffer.from(hex, 'hex');
    const padded  = Buffer.alloc(Math.ceil(data.length / 16) * 16, 0);
    data.copy(padded);
    return Buffer.concat([cipher.update(padded), cipher.final()]);
}

function aesDecrypt(buf, key, iv) {
    try {
        const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
        decipher.setAutoPadding(false);
        return Buffer.concat([decipher.update(buf), decipher.final()]);
    } catch {
        return null;
    }
}

// Build packet dengan header FF (sesuai format TCP FF)
// header format: [type 2B][00][00][size 2B LE]
function buildPacket(typeHex, payloadHex, key, iv) {
    try {
        const enc     = aesEncrypt(payloadHex, key, iv);
        const encHex  = enc.toString('hex');
        const size    = (encHex.length / 2);
        const sizeHex = size.toString(16).padStart(4, '0');
        return Buffer.from(typeHex + '0000' + sizeHex + encHex, 'hex');
    } catch (e) {
        return null;
    }
}

// ============================================================
//  PACKET BUILDERS
// ============================================================

function buildChatPacket(msg, senderUid, chatId, chatType, key, iv) {
    const ts = Math.floor(Date.now() / 1000);
    const fields = {
        1: 1,
        2: {
            1: senderUid,
            2: chatId,
            3: chatType,
            4: msg,
            5: ts,
            7: 2,
            9: {
                1: 'SERVER PROXY BY REZA',
                2: 330,
                4: 330,
                5: 102000015,
                8: 'SERVER PROXY BY REZA',
                10: 1,
                11: 1,
                13: { 1: 2 },
            },
            10: 'en',
            13: { 2: 2, 3: 1 },
        },
    };
    const proto = encodeProto(fields).toString('hex');
    return buildPacket('1215', proto, key, iv);
}

function buildPrime8Packet(senderUid, chatId, key, iv) {
    const ts     = Math.floor(Date.now() / 1000);
    const share  = JSON.stringify({
        SetShareID: 8,
        ShareeAccountID: senderUid,
        SharerAccountID: senderUid,
        SetShareState: 1,
        type: 'PrimeSetShare',
    });
    const fields = {
        1: 1,
        2: {
            1: senderUid,
            2: chatId,
            3: 0,
            5: ts,
            7: 1,
            8: share,
            9: {
                1: 'SERVER PROXY BY REZA',
                2: 330,
                4: 330,
                5: 102000015,
                8: 'SERVER PROXY BY REZA',
                10: 1,
                11: 1,
                13: { 1: 2 },
                14: {
                    1: 1158053040,
                    2: 8,
                    3: Buffer.from([0x10, 0x15, 0x08, 0x0a, 0x0b, 0x15, 0x0c, 0x0f,
                                    0x11, 0x04, 0x07, 0x02, 0x03, 0x0d, 0x0e, 0x12, 0x01, 0x05, 0x06]),
                },
            },
            10: 'en',
            13: { 2: 2, 3: 1 },
        },
    };
    const proto = encodeProto(fields).toString('hex');
    return buildPacket('1215', proto, key, iv);
}

function buildBadgePacket(squadOwnerUid, badgeValue, key, iv) {
    // Badge via join request — field layout sesuai xC4.py
    const fields = {
        1: squadOwnerUid,
        2: squadOwnerUid,
        7: 1,
        14: {
            1: {
                1: 1,
                2: 1,
                3: Math.floor(Math.random() * 180) + 1,
                4: 1,
                5: Math.floor(Date.now() / 1000),
                6: 'IND',
            },
        },
    };
    const proto = encodeProto(fields).toString('hex');
    return buildPacket('1201', proto, key, iv);
}

// ============================================================
//  INFO TEXT — baca dari gamevar / bot config
// ============================================================
const PROXY_BRAND    = '[FFF000][B]SERVER PROXY BY REZA';
const BOT_BADGE_VAL  = 32768; // V-Badge s2

function buildInfoText() {
    return [
        '[FFF000][B]━━━━━━━━━━━━━━━━━━━━━━',
        '[FFF000][B]🌐 SERVER PROXY BY REZA',
        '[FFFFFF]━━━━━━━━━━━━━━━━━━━━━━',
        '[FFFF00]📡 [FFFFFF]Server   : Proxy Mod Menu Reza',
        '[FFFF00]⚡ [FFFFFF]Region   : ID / SG / MY / VN',
        '[FFFF00]🔧 [FFFFFF]Features :',
        '[FFFFFF]  ✦ Traffic Interception',
        '[FFFFFF]  ✦ SwitchFunc / RemoteConfig Proxy',
        '[FFFFFF]  ✦ Auto SSL Bypass',
        '[FFFF00]🛡️ [FFFFFF]Status   : [00FF00]ONLINE ✅',
        '[FFF000]━━━━━━━━━━━━━━━━━━━━━━',
    ].join('\n');
}

// ============================================================
//  SESSION CLASS
// ============================================================

class BotSession {
    constructor(sessionId, uid, serverIp, serverPort, key, iv, region) {
        this.sessionId    = sessionId;
        this.uid          = uid;
        this.serverIp     = serverIp;
        this.serverPort   = serverPort;
        this.key          = key;         // Buffer — hanya hidup selama session
        this.iv           = iv;          // Buffer — idem
        this.region       = region || 'IND';

        // State
        this.status       = 'connecting'; // connecting|connected|reconnecting|closed
        this.inSquad      = false;
        this.squadOwnerId = null;
        this.lastActivity = Date.now();
        this.retryCount   = 0;

        // Connection handles
        this._socket      = null;
        this._reconnTimer = null;
        this._idleTimer   = null;
        this._closed      = false;

        // Cooldown untuk announce agar tidak spam
        this._lastAnnounce = 0;

        // Announce cooldown
        this._ANNOUNCE_CD  = 5000; // ms
    }

    // ---- Lifecycle ----------------------------------------

    start() {
        if (this._closed) return;
        this._connect();
        this._resetIdleTimer();
    }

    _connect() {
        if (this._closed) return;

        this._socket = new net.Socket();
        this._socket.setKeepAlive(true, 15_000);
        this._socket.setTimeout(30_000); // 30 detik timeout baca

        this.status = 'connecting';
        log(this.sessionId, `Connecting to ${this.serverIp}:${this.serverPort}`);

        this._socket.connect(this.serverPort, this.serverIp, () => {
            this.status       = 'connected';
            this.retryCount   = 0;
            this.lastActivity = Date.now();
            log(this.sessionId, 'Connected');
            this._resetIdleTimer();
            this._onConnected();
        });

        // Terima data dari server
        let readBuf = Buffer.alloc(0);
        this._socket.on('data', (chunk) => {
            this.lastActivity = Date.now();
            this._resetIdleTimer();

            readBuf = Buffer.concat([readBuf, chunk]);

            // Guard: jangan biarkan buffer membengkak tak terbatas
            if (readBuf.length > READ_BUF_LIMIT) {
                readBuf = readBuf.slice(readBuf.length - READ_BUF_LIMIT);
            }

            // Proses semua paket yang sudah lengkap
            readBuf = this._processBuffer(readBuf);
        });

        this._socket.on('timeout', () => {
            log(this.sessionId, 'Socket timeout, destroying');
            this._socket.destroy();
        });

        this._socket.on('error', (err) => {
            // Jangan log error ECONNRESET yang umum terjadi
            if (err.code !== 'ECONNRESET') {
                log(this.sessionId, `Socket error: ${err.message}`);
            }
        });

        this._socket.on('close', () => {
            if (this._closed) return;
            log(this.sessionId, 'Disconnected');
            this.status  = 'reconnecting';
            this.inSquad = false;
            this._scheduleReconnect();
        });
    }

    _onConnected() {
        // Kirim auth token / keep-alive awal jika diperlukan
        // Saat ini placeholder — logika auth spesifik bisa ditambahkan
        // sesuai format session yang diterima dari proxy
        log(this.sessionId, 'Session ready, bot features active');
    }

    _processBuffer(buf) {
        // Format header minimal: 4 byte type + 2 byte size
        while (buf.length >= 6) {
            const typeHex = buf.slice(0, 2).toString('hex');
            const size    = buf.readUInt16BE(4);
            const total   = 6 + size;

            if (buf.length < total) break; // tunggu data lebih

            const payload = buf.slice(6, total);
            buf           = buf.slice(total);

            this._handlePacket(typeHex, payload).catch((e) => {
                log(this.sessionId, `Packet handler error: ${e.message}`);
            });
        }
        return buf;
    }

    async _handlePacket(typeHex, payload) {
        try {
            const dec = this.key && this.iv ? aesDecrypt(payload, this.key, this.iv) : payload;
            if (!dec) return;

            const hex = dec.toString('hex');

            // Deteksi squad join (paket 0500 dengan data invite)
            if (typeHex === PT_ONLINE_IN) {
                await this._handleOnlinePacket(hex);
            }
            // Deteksi chat incoming (1200)
            else if (typeHex === '1200') {
                await this._handleChatPacket(hex);
            }
        } catch (_) {
            // Abaikan paket malformed
        }
    }

    async _handleOnlinePacket(hex) {
        // Cek apakah ini squad invite (field 1 = tipe tertentu)
        // Parsing minimal — cukup untuk deteksi join event
        try {
            const buf = Buffer.from(hex, 'hex');
            if (!buf.length) return;

            const { value: tag } = readVarintFromBuf(buf, 0);
            const fieldNum = Number(tag >> 3n);
            if (fieldNum !== 1) return; // bukan paket yang relevan

            // Jika sudah di squad, update lastActivity saja
            if (this.inSquad) return;

            // Deteksi gabung squad — setelah ini aktifkan fitur
            // (logika lebih spesifik bisa ditambah sesuai packet sniffer)
        } catch (_) {}
    }

    async _handleChatPacket(hex) {
        try {
            const buf = Buffer.from(hex, 'hex');
            if (buf.length < 4) return;

            // Decode pesan masuk — cari field 4 (msg string)
            const msg = this._extractMsgFromProto(buf);
            if (!msg) return;

            if (msg.trim().toLowerCase() === '@info') {
                await this._sendInfoReply();
            }
        } catch (_) {}
    }

    _extractMsgFromProto(buf) {
        // Scan wire-format sederhana untuk field 4 (pesan chat)
        let offset = 0;
        while (offset < buf.length) {
            const tagR  = readVarintFromBuf(buf, offset);
            const tag   = tagR.value;
            offset      = tagR.next;
            const field = Number(tag >> 3n);
            const wire  = Number(tag & 7n);

            if (wire === 0) {
                const vr = readVarintFromBuf(buf, offset);
                offset   = vr.next;
            } else if (wire === 2) {
                const lr  = readVarintFromBuf(buf, offset);
                offset    = lr.next;
                const len = Number(lr.value);
                if (offset + len > buf.length) break;

                if (field === 4) { // field 4 = chat message string
                    return buf.slice(offset, offset + len).toString('utf8');
                }
                // Masuk ke nested (field 2 = data outer)
                if (field === 2) {
                    const nested = this._extractMsgFromProto(buf.slice(offset, offset + len));
                    if (nested) return nested;
                }
                offset += len;
            } else if (wire === 1) {
                offset += 8;
            } else if (wire === 5) {
                offset += 4;
            } else {
                break;
            }
        }
        return null;
    }

    // ---- Feature Actions ----------------------------------

    notifySquadJoin(squadOwnerUid) {
        if (this._closed) return;
        this.inSquad      = true;
        this.squadOwnerId = squadOwnerUid;
        this.lastActivity = Date.now();
        log(this.sessionId, `Squad join detected: owner=${squadOwnerUid}`);
        this._runSquadJoinFeatures(squadOwnerUid);
    }

    _runSquadJoinFeatures(squadOwnerUid) {
        // Announce cooldown
        const now = Date.now();
        if (now - this._lastAnnounce >= this._ANNOUNCE_CD) {
            this._lastAnnounce = now;
            setTimeout(() => this._sendAnnouncement(squadOwnerUid), 2000);
        }

        // Prime 8 + badge
        setTimeout(() => this._sendPrime8(squadOwnerUid), 1800);
        setTimeout(() => this._sendBadge(squadOwnerUid), 2500);
    }

    _sendAnnouncement(squadOwnerUid) {
        if (!this.key || !this.iv || !this._isConnected()) return;
        const pkt = buildChatPacket(
            PROXY_BRAND,
            this.uid,
            squadOwnerUid,
            0, // chat_type squad
            this.key,
            this.iv,
        );
        this._writePacket(pkt);
        log(this.sessionId, 'Announcement sent');
    }

    _sendPrime8(squadOwnerUid) {
        if (!this.key || !this.iv || !this._isConnected()) return;
        const pkt = buildPrime8Packet(this.uid, squadOwnerUid, this.key, this.iv);
        this._writePacket(pkt);
        log(this.sessionId, 'Prime 8 packet sent');
    }

    _sendBadge(squadOwnerUid) {
        if (!this.key || !this.iv || !this._isConnected()) return;
        for (let i = 0; i < 3; i++) {
            setTimeout(() => {
                if (!this._isConnected()) return;
                const pkt = buildBadgePacket(squadOwnerUid, BOT_BADGE_VAL, this.key, this.iv);
                this._writePacket(pkt);
            }, i * 200);
        }
        log(this.sessionId, 'Badge packets sent');
    }

    _sendInfoReply() {
        if (!this.key || !this.iv || !this._isConnected()) return;
        const chatId = this.squadOwnerId || this.uid;
        const pkt    = buildChatPacket(
            buildInfoText(),
            this.uid,
            chatId,
            this.inSquad ? 0 : 2, // squad atau private
            this.key,
            this.iv,
        );
        this._writePacket(pkt);
        log(this.sessionId, '@info reply sent');
    }

    _writePacket(pkt) {
        if (!pkt || !this._isConnected()) return;
        try {
            this._socket.write(pkt);
        } catch (e) {
            log(this.sessionId, `Write error: ${e.message}`);
        }
    }

    _isConnected() {
        return this._socket
            && !this._socket.destroyed
            && this.status === 'connected';
    }

    // ---- Reconnect ----------------------------------------

    _scheduleReconnect() {
        if (this._closed) return;
        if (this.retryCount >= MAX_RETRIES) {
            log(this.sessionId, 'Max retries reached — closing session');
            this.destroy();
            return;
        }

        const delay = RECONNECT_DELAYS[this.retryCount] * 1000;
        this.retryCount++;
        log(this.sessionId, `Reconnect in ${delay / 1000}s (attempt ${this.retryCount}/${MAX_RETRIES})`);

        this._reconnTimer = setTimeout(() => {
            if (!this._closed) this._connect();
        }, delay);
    }

    // ---- Idle timer ---------------------------------------

    _resetIdleTimer() {
        if (this._idleTimer) clearTimeout(this._idleTimer);
        this._idleTimer = setTimeout(() => {
            log(this.sessionId, 'Idle timeout — destroying session');
            this.destroy();
        }, IDLE_TIMEOUT_MS);
    }

    // ---- Cleanup ------------------------------------------

    destroy() {
        if (this._closed) return;
        this._closed = true;
        this.status  = 'closed';

        if (this._idleTimer)   { clearTimeout(this._idleTimer);   this._idleTimer   = null; }
        if (this._reconnTimer) { clearTimeout(this._reconnTimer);  this._reconnTimer = null; }

        if (this._socket && !this._socket.destroyed) {
            this._socket.removeAllListeners();
            this._socket.destroy();
        }
        this._socket = null;

        // Hapus key/iv dari memory segera
        if (this.key) this.key.fill(0);
        if (this.iv)  this.iv.fill(0);
        this.key = null;
        this.iv  = null;

        log(this.sessionId, 'Session destroyed');
    }
}

// ============================================================
//  SESSION MANAGER
// ============================================================

class SessionManager {
    constructor() {
        // Map<sessionId, BotSession>
        this._sessions = new Map();

        // Map<uid, sessionId> — untuk cegah duplikat per UID
        this._uidIndex = new Map();

        // Cleanup stale sessions setiap 5 menit
        this._cleanupTimer = setInterval(() => this._cleanupStale(), 5 * 60_000);
        this._cleanupTimer.unref(); // jangan blokir process exit
    }

    // ---- Public API ---------------------------------------

    /**
     * Buat session baru untuk user.
     * Return false jika duplikat / melebihi batas.
     */
    createSession({ uid, serverIp, serverPort, key, iv, region }) {
        // Validasi input dasar
        if (!uid || !serverIp || !serverPort || !Buffer.isBuffer(key) || !Buffer.isBuffer(iv)) {
            log('MGR', 'createSession: invalid params');
            return false;
        }

        // Cegah duplikat per UID
        if (this._uidIndex.has(uid)) {
            const existId  = this._uidIndex.get(uid);
            const existing = this._sessions.get(existId);
            if (existing && !existing._closed) {
                log('MGR', `Duplicate session rejected for uid=${uid}`);
                return false;
            }
            // Session lama sudah mati, boleh buat baru
            this._sessions.delete(existId);
            this._uidIndex.delete(uid);
        }

        // Cek batas maksimum
        if (this._sessions.size >= MAX_SESSIONS) {
            log('MGR', `Max sessions (${MAX_SESSIONS}) reached — rejecting uid=${uid}`);
            return false;
        }

        const sessionId = crypto.randomBytes(8).toString('hex');
        const session   = new BotSession(sessionId, uid, serverIp, serverPort, key, iv, region);

        this._sessions.set(sessionId, session);
        this._uidIndex.set(uid, sessionId);

        session.start();
        log('MGR', `Session created: id=${sessionId} uid=${uid} (total=${this._sessions.size})`);
        return sessionId;
    }

    /**
     * Notifikasi squad join — dipanggil dari proxy.js saat
     * mendeteksi event join di traffic game.
     */
    notifySquadJoin(uid, squadOwnerUid) {
        const session = this._getByUid(uid);
        if (session) session.notifySquadJoin(squadOwnerUid);
    }

    /**
     * Hapus session user (saat client disconnect dari proxy).
     */
    removeByUid(uid) {
        const sessionId = this._uidIndex.get(uid);
        if (!sessionId) return;

        const session = this._sessions.get(sessionId);
        if (session) session.destroy();

        this._sessions.delete(sessionId);
        this._uidIndex.delete(uid);
        log('MGR', `Session removed for uid=${uid}`);
    }

    /**
     * Update lastActivity saat client masih aktif.
     */
    touchByUid(uid) {
        const session = this._getByUid(uid);
        if (session) {
            session.lastActivity = Date.now();
            session._resetIdleTimer();
        }
    }

    /** Status ringkas untuk endpoint diagnostik */
    getStatus() {
        const active = [];
        for (const [sid, s] of this._sessions) {
            active.push({
                sessionId:    sid,
                uid:          s.uid,
                status:       s.status,
                inSquad:      s.inSquad,
                retryCount:   s.retryCount,
                idleSec:      Math.floor((Date.now() - s.lastActivity) / 1000),
            });
        }
        return { total: active.length, max: MAX_SESSIONS, sessions: active };
    }

    // ---- Internal ----------------------------------------

    _getByUid(uid) {
        const sessionId = this._uidIndex.get(uid);
        if (!sessionId) return null;
        const session   = this._sessions.get(sessionId);
        if (!session || session._closed) {
            this._sessions.delete(sessionId);
            this._uidIndex.delete(uid);
            return null;
        }
        return session;
    }

    _cleanupStale() {
        const now     = Date.now();
        let   removed = 0;
        for (const [sid, session] of this._sessions) {
            const idle = now - session.lastActivity;
            if (session._closed || idle > IDLE_TIMEOUT_MS + 30_000) {
                session.destroy();
                this._sessions.delete(sid);
                this._uidIndex.delete(session.uid);
                removed++;
            }
        }
        if (removed > 0) log('MGR', `Stale cleanup: removed ${removed} sessions (remaining=${this._sessions.size})`);
    }

    /** Graceful shutdown — dipanggil saat process exit */
    shutdown() {
        clearInterval(this._cleanupTimer);
        log('MGR', `Shutting down — closing ${this._sessions.size} sessions`);
        for (const session of this._sessions.values()) {
            session.destroy();
        }
        this._sessions.clear();
        this._uidIndex.clear();
    }
}

// ============================================================
//  LOGGER (jangan log credential/token/data sensitif)
// ============================================================

function log(tag, msg) {
    const ts = new Date().toISOString().slice(11, 23);
    console.log(`[TCP:${tag}] [${ts}] ${msg}`);
}

// ============================================================
//  SINGLETON EXPORT
// ============================================================

const manager = new SessionManager();

// Graceful shutdown hooks
function _shutdown() {
    manager.shutdown();
}
process.once('SIGINT',  _shutdown);
process.once('SIGTERM', _shutdown);

module.exports = { manager, BotSession, log };
