'use strict';

// ============================================================
//  modules/tcp.js — Per-User TCP Bot Session Manager v1.1.0
//  Perubahan v1.1:
//    - handleBannedUid(): auto-destroy session saat ban terdeteksi
//    - Integrasi dengan proxy.js via setTcpManager()
//    - Log ban event dengan ban_mode
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

let _cachedBotCfg     = null;
let _cachedBotCfgTime = 0;
const BOT_CFG_TTL_MS  = 60_000;

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
const MAX_SESSIONS     = 50;
const IDLE_TIMEOUT_MS  = 10 * 60_000;
const RECONNECT_DELAYS = [2, 5, 10, 30, 60];
const MAX_RETRIES      = RECONNECT_DELAYS.length;
const READ_BUF_LIMIT   = 64 * 1024;

const PT_CHAT_IN   = '1200';
const PT_ONLINE_IN = '0500';

// ============================================================
//  PROTOBUF HELPERS
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
            1: senderUid, 2: chatId, 3: chatType, 4: msg, 5: ts, 7: 2,
            9: {
                1: 'SERVER PROXY BY REZA', 2: 330, 4: 330, 5: 102000015,
                8: 'SERVER PROXY BY REZA', 10: 1, 11: 1, 13: { 1: 2 },
            },
            10: 'en', 13: { 2: 2, 3: 1 },
        },
    };
    const proto = encodeProto(fields).toString('hex');
    return buildPacket('1215', proto, key, iv);
}

function buildPrime8Packet(senderUid, chatId, key, iv) {
    const ts    = Math.floor(Date.now() / 1000);
    const share = JSON.stringify({
        SetShareID: 8, ShareeAccountID: senderUid,
        SharerAccountID: senderUid, SetShareState: 1, type: 'PrimeSetShare',
    });
    const fields = {
        1: 1,
        2: {
            1: senderUid, 2: chatId, 3: 0, 5: ts, 7: 1, 8: share,
            9: {
                1: 'SERVER PROXY BY REZA', 2: 330, 4: 330, 5: 102000015,
                8: 'SERVER PROXY BY REZA', 10: 1, 11: 1, 13: { 1: 2 },
                14: {
                    1: 1158053040, 2: 8,
                    3: Buffer.from([0x10,0x15,0x08,0x0a,0x0b,0x15,0x0c,0x0f,
                                    0x11,0x04,0x07,0x02,0x03,0x0d,0x0e,0x12,0x01,0x05,0x06]),
                },
            },
            10: 'en', 13: { 2: 2, 3: 1 },
        },
    };
    const proto = encodeProto(fields).toString('hex');
    return buildPacket('1215', proto, key, iv);
}

function buildBadgePacket(squadOwnerUid, badgeValue, key, iv) {
    const fields = {
        1: squadOwnerUid, 2: squadOwnerUid, 7: 1,
        14: {
            1: {
                1: 1, 2: 1,
                3: Math.floor(Math.random() * 180) + 1,
                4: 1, 5: Math.floor(Date.now() / 1000), 6: 'IND',
            },
        },
    };
    const proto = encodeProto(fields).toString('hex');
    return buildPacket('1201', proto, key, iv);
}

const PROXY_BRAND   = '[FFF000][B]SERVER PROXY BY REZA';
const BOT_BADGE_VAL = 32768;

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
        this.key          = key;
        this.iv           = iv;
        this.region       = region || 'IND';

        this.status       = 'connecting';
        this.inSquad      = false;
        this.squadOwnerId = null;
        this.lastActivity = Date.now();
        this.retryCount   = 0;
        this.banned       = false;   // ← flag ban

        this._socket      = null;
        this._reconnTimer = null;
        this._idleTimer   = null;
        this._closed      = false;

        this._lastAnnounce = 0;
        this._ANNOUNCE_CD  = 5000;
    }

    start() {
        if (this._closed) return;
        this._connect();
        this._resetIdleTimer();
    }

    _connect() {
        if (this._closed || this.banned) return;

        this._socket = new net.Socket();
        this._socket.setKeepAlive(true, 15_000);
        this._socket.setTimeout(30_000);

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

        let readBuf = Buffer.alloc(0);
        this._socket.on('data', (chunk) => {
            this.lastActivity = Date.now();
            this._resetIdleTimer();
            readBuf = Buffer.concat([readBuf, chunk]);
            if (readBuf.length > READ_BUF_LIMIT)
                readBuf = readBuf.slice(readBuf.length - READ_BUF_LIMIT);
            readBuf = this._processBuffer(readBuf);
        });

        this._socket.on('timeout', () => {
            log(this.sessionId, 'Socket timeout, destroying');
            this._socket.destroy();
        });

        this._socket.on('error', (err) => {
            if (err.code !== 'ECONNRESET')
                log(this.sessionId, `Socket error: ${err.message}`);
        });

        this._socket.on('close', () => {
            if (this._closed || this.banned) return;
            log(this.sessionId, 'Disconnected');
            this.status  = 'reconnecting';
            this.inSquad = false;
            this._scheduleReconnect();
        });
    }

    _onConnected() {
        log(this.sessionId, 'Session ready, bot features active');
    }

    _processBuffer(buf) {
        while (buf.length >= 6) {
            const typeHex = buf.slice(0, 2).toString('hex');
            const size    = buf.readUInt16BE(4);
            const total   = 6 + size;
            if (buf.length < total) break;
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
            if (typeHex === PT_ONLINE_IN) {
                await this._handleOnlinePacket(hex);
            } else if (typeHex === '1200') {
                await this._handleChatPacket(hex);
            }
        } catch (_) {}
    }

    async _handleOnlinePacket(hex) {
        try {
            const buf = Buffer.from(hex, 'hex');
            if (!buf.length) return;
            const { value: tag } = readVarintFromBuf(buf, 0);
            const fieldNum = Number(tag >> 3n);
            if (fieldNum !== 1) return;
            if (this.inSquad) return;
        } catch (_) {}
    }

    async _handleChatPacket(hex) {
        try {
            const buf = Buffer.from(hex, 'hex');
            if (buf.length < 4) return;
            const msg = this._extractMsgFromProto(buf);
            if (!msg) return;
            if (msg.trim().toLowerCase() === '@info') {
                await this._sendInfoReply();
            }
        } catch (_) {}
    }

    _extractMsgFromProto(buf) {
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
                if (field === 4)
                    return buf.slice(offset, offset + len).toString('utf8');
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

    // ---- Ban Handling ------------------------------------

    /**
     * Dipanggil oleh SessionManager saat proxy mendeteksi ban
     * dari response Garena. Session langsung di-destroy,
     * tidak reconnect.
     */
    markBanned(banMode) {
        if (this._closed) return;
        this.banned = true;
        log(this.sessionId, `🚫 BANNED (ban_mode=${banMode}) — session destroyed`);
        this.destroy();
    }

    // ---- Feature Actions ---------------------------------

    notifySquadJoin(squadOwnerUid) {
        if (this._closed || this.banned) return;
        this.inSquad      = true;
        this.squadOwnerId = squadOwnerUid;
        this.lastActivity = Date.now();
        log(this.sessionId, `Squad join detected: owner=${squadOwnerUid}`);
        this._runSquadJoinFeatures(squadOwnerUid);
    }

    _runSquadJoinFeatures(squadOwnerUid) {
        const now = Date.now();
        if (now - this._lastAnnounce >= this._ANNOUNCE_CD) {
            this._lastAnnounce = now;
            setTimeout(() => this._sendAnnouncement(squadOwnerUid), 2000);
        }
        setTimeout(() => this._sendPrime8(squadOwnerUid), 1800);
        setTimeout(() => this._sendBadge(squadOwnerUid),  2500);
    }

    _sendAnnouncement(squadOwnerUid) {
        if (!this.key || !this.iv || !this._isConnected()) return;
        const pkt = buildChatPacket(PROXY_BRAND, this.uid, squadOwnerUid, 0, this.key, this.iv);
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
            buildInfoText(), this.uid, chatId,
            this.inSquad ? 0 : 2, this.key, this.iv,
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

    _scheduleReconnect() {
        if (this._closed || this.banned) return;
        if (this.retryCount >= MAX_RETRIES) {
            log(this.sessionId, 'Max retries reached — closing session');
            this.destroy();
            return;
        }
        const delay = RECONNECT_DELAYS[this.retryCount] * 1000;
        this.retryCount++;
        log(this.sessionId, `Reconnect in ${delay / 1000}s (attempt ${this.retryCount}/${MAX_RETRIES})`);
        this._reconnTimer = setTimeout(() => {
            if (!this._closed && !this.banned) this._connect();
        }, delay);
    }

    _resetIdleTimer() {
        if (this._idleTimer) clearTimeout(this._idleTimer);
        this._idleTimer = setTimeout(() => {
            log(this.sessionId, 'Idle timeout — destroying session');
            this.destroy();
        }, IDLE_TIMEOUT_MS);
    }

    destroy() {
        if (this._closed) return;
        this._closed = true;
        this.status  = 'closed';

        if (this._idleTimer)   { clearTimeout(this._idleTimer);  this._idleTimer   = null; }
        if (this._reconnTimer) { clearTimeout(this._reconnTimer); this._reconnTimer = null; }

        if (this._socket && !this._socket.destroyed) {
            this._socket.removeAllListeners();
            this._socket.destroy();
        }
        this._socket = null;

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
        this._sessions = new Map();  // Map<sessionId, BotSession>
        this._uidIndex = new Map();  // Map<uid, sessionId>

        this._cleanupTimer = setInterval(() => this._cleanupStale(), 5 * 60_000);
        this._cleanupTimer.unref();
    }

    createSession({ uid, serverIp, serverPort, key, iv, region }) {
        if (!uid || !serverIp || !serverPort || !Buffer.isBuffer(key) || !Buffer.isBuffer(iv)) {
            log('MGR', 'createSession: invalid params');
            return false;
        }

        if (this._uidIndex.has(uid)) {
            const existId  = this._uidIndex.get(uid);
            const existing = this._sessions.get(existId);
            if (existing && !existing._closed) {
                log('MGR', `Duplicate session rejected for uid=${uid}`);
                return false;
            }
            this._sessions.delete(existId);
            this._uidIndex.delete(uid);
        }

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
     * Dipanggil dari proxy.js (via setTcpManager) saat response
     * Garena mengindikasikan akun di-ban.
     * Session langsung di-destroy dan dihapus dari map.
     */
    handleBannedUid(uid, banMode) {
        const sessionId = this._uidIndex.get(uid);
        if (!sessionId) {
            log('MGR', `handleBannedUid: no session for uid=${uid}`);
            return;
        }
        const session = this._sessions.get(sessionId);
        if (session) {
            session.markBanned(banMode || 1); // destroy + set banned flag
        }
        // Hapus dari index & map segera
        this._sessions.delete(sessionId);
        this._uidIndex.delete(uid);
        log('MGR', `🚫 Banned session cleaned up: uid=${uid} (remaining=${this._sessions.size})`);
    }

    notifySquadJoin(uid, squadOwnerUid) {
        const session = this._getByUid(uid);
        if (session) session.notifySquadJoin(squadOwnerUid);
    }

    removeByUid(uid) {
        const sessionId = this._uidIndex.get(uid);
        if (!sessionId) return;
        const session = this._sessions.get(sessionId);
        if (session) session.destroy();
        this._sessions.delete(sessionId);
        this._uidIndex.delete(uid);
        log('MGR', `Session removed for uid=${uid}`);
    }

    touchByUid(uid) {
        const session = this._getByUid(uid);
        if (session) {
            session.lastActivity = Date.now();
            session._resetIdleTimer();
        }
    }

    getStatus() {
        const active = [];
        for (const [sid, s] of this._sessions) {
            active.push({
                sessionId:  sid,
                uid:        s.uid,
                status:     s.status,
                inSquad:    s.inSquad,
                banned:     s.banned,
                retryCount: s.retryCount,
                idleSec:    Math.floor((Date.now() - s.lastActivity) / 1000),
            });
        }
        return { total: active.length, max: MAX_SESSIONS, sessions: active };
    }

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
            if (session._closed || session.banned || idle > IDLE_TIMEOUT_MS + 30_000) {
                session.destroy();
                this._sessions.delete(sid);
                this._uidIndex.delete(session.uid);
                removed++;
            }
        }
        if (removed > 0)
            log('MGR', `Stale cleanup: removed ${removed} sessions (remaining=${this._sessions.size})`);
    }

    shutdown() {
        clearInterval(this._cleanupTimer);
        log('MGR', `Shutting down — closing ${this._sessions.size} sessions`);
        for (const session of this._sessions.values()) session.destroy();
        this._sessions.clear();
        this._uidIndex.clear();
    }
}

// ============================================================
//  LOGGER
// ============================================================
function log(tag, msg) {
    const ts = new Date().toISOString().slice(11, 23);
    console.log(`[TCP:${tag}] [${ts}] ${msg}`);
}

// ============================================================
//  SINGLETON EXPORT
// ============================================================
const manager = new SessionManager();

process.once('SIGINT',  () => manager.shutdown());
process.once('SIGTERM', () => manager.shutdown());

module.exports = { manager, BotSession, log };
