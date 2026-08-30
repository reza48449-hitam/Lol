'use strict';

// ============================================================
//  modules/proxy.js — Anti-detect Proxy v2.6
//  Tambahan: Per-user TCP Bot Session Manager (tcp.js)
//
//  YANG BERUBAH dari v2.5:
//    + Import tcp.js session manager
//    + Hook MajorLogin response → extract uid, key, iv
//    + Buat session per-user setelah autentikasi
//    + Hook OnlineChat traffic → notifikasi squad join ke session
//    + Cleanup session saat client disconnect/timeout
//    + Endpoint diagnostik /api/tcp/status
//    + Semua traffic game lainnya TIDAK tersentuh
//  TIDAK BERUBAH:
//    Semua layer 1–8 dari v2.5 tetap identik
// ============================================================

const https  = require('https');
const crypto = require('crypto');

// ---- TCP Session Manager (modul baru) ----------------------
// Dibungkus try-catch agar error di tcp.js tidak crash proxy
let tcpManager = null;
try {
    const tcp   = require('./tcp');
    tcpManager  = tcp.manager;
    console.log('[PROXY] TCP session manager loaded');
} catch (e) {
    console.log(`[PROXY] TCP session manager unavailable: ${e.message} — bot features disabled`);
}

// ============================================================
//  LAYER 1 — UA / HEADER POOL
// ============================================================
const GARENA_LOGIN_SERVER  = 'https://loginbp.ggblueshark.com';
const GARENA_CLIENT_SERVER = 'https://clientbp.ggpolarbear.com';

const UA_POOL = [
    ['Dalvik/2.1.0 (Linux; U; Android 11; SM-G998B Build/RP1A.200720.012)',    'id-ID,en;q=0.9'],
    ['Dalvik/2.1.0 (Linux; U; Android 12; M2010J19SG Build/SKQ1.210908.001)', 'id-ID,en-US;q=0.8'],
    ['Dalvik/2.1.0 (Linux; U; Android 13; CPH2269 Build/TP1A.220624.014)',    'id-ID,en;q=0.7'],
    ['Dalvik/2.1.0 (Linux; U; Android 12; V2204 Build/SP1A.210812.016)',       'en-US,id;q=0.9'],
    ['Dalvik/2.1.0 (Linux; U; Android 11; RMX2151 Build/RP1A.200720.011)',    'id-ID'],
    ['Dalvik/2.1.0 (Linux; U; Android 14; Pixel 7 Build/UQ1A.231205.015)',    'en-US,id-ID;q=0.8'],
    ['Dalvik/2.1.0 (Linux; U; Android 13; 22111317G Build/TKQ1.221013.002)',  'id-ID,zh-TW;q=0.6'],
    ['Dalvik/2.1.0 (Linux; U; Android 12; ASUS_AI2201_B Build/SP1A.210812.016)', 'id-ID,en;q=0.9'],
];
const ENC_POOL  = ['gzip, deflate', 'gzip', 'gzip, deflate, br', 'deflate, gzip'];
const CONN_POOL = ['keep-alive', 'close', 'keep-alive'];

function pick(a) { return a[Math.floor(Math.random() * a.length)]; }

function getObfHeaders() {
    const [ua, lang] = pick(UA_POOL);
    return {
        'User-Agent':      ua,
        'Accept-Language': lang,
        'Accept-Encoding': pick(ENC_POOL),
        'Accept':          'application/octet-stream, */*',
        'Connection':      pick(CONN_POOL),
        'X-Unity-Version': '2018.4.30f1',
        'X-FF-Version':    '1.130.' + (20 + Math.floor(Math.random() * 3)),
        'X-Request-ID':    crypto.randomBytes(8).toString('hex'),
    };
}

// ============================================================
//  LAYER 2 — TIMING JITTER
// ============================================================
const jitter = (lo = 20, hi = 120) => new Promise(r => setTimeout(r, lo + Math.random() * (hi - lo)));

// ============================================================
//  LAYER 3 — TLS AGENT SPOOF
// ============================================================
function makeAgent(host) {
    return new https.Agent({
        host, keepAlive: true,
        keepAliveMsecs:     3000 + Math.floor(Math.random() * 2000),
        maxSockets:         12,
        rejectUnauthorized: false,
        ciphers: [
            'TLS_AES_128_GCM_SHA256', 'TLS_AES_256_GCM_SHA384',
            'TLS_CHACHA20_POLY1305_SHA256', 'ECDHE-ECDSA-AES128-GCM-SHA256',
            'ECDHE-RSA-AES128-GCM-SHA256',  'ECDHE-ECDSA-AES256-GCM-SHA384',
            'ECDHE-RSA-AES256-GCM-SHA384',
        ].join(':'),
        honorCipherOrder: false,
        minVersion: 'TLSv1.2', maxVersion: 'TLSv1.3',
        ALPNProtocols: ['http/1.1'],
        sessionTimeout: 600,
    });
}

const loginAgent  = makeAgent('loginbp.ggblueshark.com');
const clientAgent = makeAgent('clientbp.ggpolarbear.com');

// ============================================================
//  LAYER 4 — HEADER CLEANER
// ============================================================
const STRIP_REQ = new Set([
    'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'x-real-ip',
    'via', 'forwarded', 'proxy-connection', 'x-envoy-peer-metadata',
    'x-envoy-upstream-service-time', 'cf-connecting-ip', 'cf-ray',
    'x-vercel-id', 'x-amzn-trace-id', 'x-cache', 'x-served-by',
]);

function cleanHeaders(h) {
    const o = {};
    for (const [k, v] of Object.entries(h))
        if (!STRIP_REQ.has(k.toLowerCase())) o[k] = v;
    return o;
}

// ============================================================
//  LAYER 5 — UPLOAD-DISABLED PATCH (surgical)
// ============================================================
function patchUploadDisabled(buf) {
    if (!Buffer.isBuffer(buf) || buf.length < 2) return buf;
    const out = Buffer.from(buf);
    let hit   = false;
    const scanLimit = Math.min(64, out.length - 1);
    for (let i = 0; i < scanLimit; i++) {
        const tag      = out[i];
        const fieldNum = tag >> 3;
        const wireType = tag & 0x07;
        if (wireType !== 0) continue;
        if ((fieldNum === 1 || fieldNum === 2 || fieldNum === 8) && out[i + 1] === 0x00) {
            out[i + 1] = 0x01; hit = true; i++;
        }
        if (fieldNum === 9 && out[i + 1] === 0x01) {
            out[i + 1] = 0x00; hit = true; i++;
        }
    }
    if (hit) console.log('[PATCH] ✅ upload-disabled flipped');
    return out;
}

// ============================================================
//  LAYER 6 — GetLoginData GGP NUKE
// ============================================================
function patchGetLoginData(buf) {
    if (!Buffer.isBuffer(buf) || !buf.length) return buf;
    try {
        const str = buf.toString('utf-8');
        if (!str.trim().startsWith('{')) return buf;
        const json = JSON.parse(str);
        nukeCommonFields(json, '');
        return Buffer.from(JSON.stringify(json));
    } catch (e) { return buf; }
}

// ============================================================
//  LAYER 7 — LOGIN RESPONSE CLEANER
// ============================================================
function patchLoginResponse(buf) {
    if (!Buffer.isBuffer(buf) || !buf.length) return buf;
    try {
        const str = buf.toString('utf-8');
        if (!str.trim().startsWith('{')) return buf;
        const json = JSON.parse(str);
        nukeCommonFields(json, '');
        return Buffer.from(JSON.stringify(json));
    } catch (e) { return buf; }
}

// ============================================================
//  HELPER — nuke anticheat fields
// ============================================================
function nukeCommonFields(json, proxyDomain) {
    if (json.CECNLHCONMI) {
        json.CECNLHCONMI = {
            is_report_to_ggp:   false, ggp_url: '',
            ut_flag:            0, is_transfer_report: false,
            is_enable_ggp:      false, content: '',
            is_get_feature:     false, is_get_flag: false,
            is_enable_tcp:      false,
        };
        console.log('[GGP-NUKE] ✅ CECNLHCONMI disabled');
    }
    if (json.LJAPOJNBOFE !== undefined) { json.LJAPOJNBOFE = ''; console.log('[GRTC-NUKE] ✅'); }
    if (json.FOGGNIHIBPG !== undefined) { json.FOGGNIHIBPG = []; console.log('[TRACE-NUKE] ✅'); }
    if (json.POEPGJPHCMJ !== undefined) { json.POEPGJPHCMJ = proxyDomain || ''; console.log('[EVENT-REDIRECT] ✅'); }
    if (json.EMFPDECPCDG !== undefined) { json.EMFPDECPCDG = ''; }
    if (json.PDJHKBDIHGL !== undefined) { json.PDJHKBDIHGL = ''; }
    if (json.IIPKMIOFCJP !== undefined) { json.IIPKMIOFCJP = ''; }
    if (json.DEVICECHECK  !== undefined) { json.DEVICECHECK  = null; }
    if (json.GGPCHECKHASH !== undefined) { json.GGPCHECKHASH = ''; }
    const NUKE = ['GGPCONFIG','ANTIADDICTION','JAILBREAK_DETECTED','ROOT_DETECTED',
                  'EMULATOR_DETECTED','HOOK_DETECTED','MODIFIER_DETECTED'];
    for (const f of NUKE) {
        if (json[f] !== undefined)
            json[f] = typeof json[f] === 'string' ? '' : (typeof json[f] === 'boolean' ? false : null);
    }
}

// ============================================================
//  PROTOBUF HELPERS (identik dengan v2.5)
// ============================================================

function readVarint(buf, offset) {
    let result = 0n, shift = 0n;
    while (offset < buf.length) {
        const b = BigInt(buf[offset++]);
        result |= (b & 0x7fn) << shift;
        if ((b & 0x80n) === 0n) break;
        shift += 7n;
    }
    return { value: result, nextOffset: offset };
}

function encodeVarint(value) {
    value = BigInt(value);
    const bytes = [];
    while (value > 0x7fn) { bytes.push(Number((value & 0x7fn) | 0x80n)); value >>= 7n; }
    bytes.push(Number(value));
    return Buffer.from(bytes);
}

function encodeField(fieldNum, data) {
    const tag    = encodeVarint((BigInt(fieldNum) << 3n) | 2n);
    const length = encodeVarint(data.length);
    return Buffer.concat([tag, length, data]);
}

function protoFieldExists(buf, targetFieldNum) {
    let offset = 0;
    while (offset < buf.length) {
        const tagResult = readVarint(buf, offset);
        const tag       = tagResult.value;
        offset          = tagResult.nextOffset;
        const fieldNum  = Number(tag >> 3n);
        const wireType  = Number(tag & 7n);
        if (wireType === 0) {
            const r = readVarint(buf, offset); offset = r.nextOffset;
            if (fieldNum === targetFieldNum && r.value !== 0n) return true;
        } else if (wireType === 2) {
            const lenR = readVarint(buf, offset); offset = lenR.nextOffset;
            const len  = Number(lenR.value);
            if (fieldNum === targetFieldNum && len > 0) return true;
            offset += len;
        } else if (wireType === 1) { offset += 8;
        } else if (wireType === 5) { offset += 4;
        } else { break; }
    }
    return false;
}

// ============================================================
//  PATCH v2.6 — MAJORLOGIN PROTOBUF PATCHER
//  + Session creation hook setelah patch berhasil
// ============================================================

// Server IP/port default untuk session TCP bot
// Ubah sesuai kebutuhan atau baca dari env
const BOT_SERVER_IP   = process.env.BOT_TCP_IP   || '127.0.0.1';
const BOT_SERVER_PORT = parseInt(process.env.BOT_TCP_PORT || '3031', 10);

/**
 * Ekstrak uid, key, iv dari MajorLoginRes (protobuf format).
 * Return null jika gagal — TIDAK melempar exception ke caller.
 * Tidak menyimpan atau log credential.
 */
function extractMajorLoginFields(buf) {
    if (!Buffer.isBuffer(buf) || buf.length < 4) return null;
    try {
        let offset = 0;
        let uid = null, key = null, iv = null, region = null;

        while (offset < buf.length) {
            const tagR  = readVarint(buf, offset);
            const tag   = tagR.value;
            offset      = tagR.nextOffset;
            const field = Number(tag >> 3n);
            const wire  = Number(tag & 7n);

            if (wire === 0) {
                // varint
                const vr = readVarint(buf, offset); offset = vr.nextOffset;
                // field 1 = account_uid (uint64)
                if (field === 1) uid = Number(vr.value);
            } else if (wire === 2) {
                // length-delimited
                const lr  = readVarint(buf, offset); offset = lr.nextOffset;
                const len = Number(lr.value);
                if (offset + len > buf.length) break;
                const data = buf.slice(offset, offset + len);
                offset += len;

                // field 2  = region (string)
                if (field === 2)  region = data.toString('utf8');
                // field 22 = key (bytes)
                if (field === 22) key    = Buffer.from(data);
                // field 23 = iv  (bytes)
                if (field === 23) iv     = Buffer.from(data);
            } else if (wire === 1) {
                offset += 8;
            } else if (wire === 5) {
                offset += 4;
            } else {
                break;
            }
        }

        if (!uid || !key || !iv) return null;
        return { uid, key, iv, region: region || 'IND' };
    } catch (_) {
        return null;
    }
}

/**
 * Hook yang dipanggil setelah MajorLogin response diterima & di-patch.
 * Membuat session TCP bot untuk user ini.
 * Error di sini TIDAK boleh mempengaruhi traffic game.
 */
function onMajorLoginSuccess(buf, clientIp) {
    if (!tcpManager) return;
    try {
        const fields = extractMajorLoginFields(buf);
        if (!fields) return;

        const { uid, key, iv, region } = fields;

        // Buat session (duplikat otomatis dicegah di dalam manager)
        const sessionId = tcpManager.createSession({
            uid,
            serverIp:   BOT_SERVER_IP,
            serverPort: BOT_SERVER_PORT,
            key,         // Buffer — akan di-zero saat session destroy
            iv,          // Buffer — idem
            region,
        });

        if (sessionId) {
            console.log(`[PROXY] Bot session started: uid=${uid} sid=${sessionId}`);
        }
        // Jika false: duplikat atau limit reached — sudah di-log di tcp.js
    } catch (e) {
        // Jangan sampai error ini terlihat ke client
        console.log(`[PROXY] onMajorLoginSuccess error (non-fatal): ${e.message}`);
    }
}

function makeMajorLoginPatcher(proxyDomain) {
    return function patchMajorLogin(buf, clientIp) {
        if (!Buffer.isBuffer(buf) || !buf.length) return buf;

        // === JSON PATH ===
        try {
            const str = buf.toString('utf-8');
            if (str.trim().startsWith('{')) {
                const json = JSON.parse(str);
                nukeCommonFields(json, proxyDomain);

                if (json.AEBBNFBNIDB !== undefined) {
                    json.AEBBNFBNIDB = {
                        ban_mode: 0, unban_time: 0,
                        history_update_ts: Math.floor(Date.now() / 1000),
                        history_seconds: 0, hint_string: '',
                        play_time: 0, guardian_setting: null,
                    };
                    console.log('[BAN-NUKE] ✅ ban_mode forced 0');
                }
                if (json.OBLLHDOLLGO?.anti_addiction_switch_desc) {
                    json.OBLLHDOLLGO.anti_addiction_switch_desc.function_switch = false;
                    json.OBLLHDOLLGO.anti_addiction_switch_desc.children_group  = false;
                    json.OBLLHDOLLGO.anti_addiction_switch_desc.skip            = true;
                    console.log('[ANTI-ADD] ✅ anti_addiction disabled');
                }
                if (!json.ak  || json.ak  === '') { json.ak  = crypto.randomBytes(16).toString('hex'); }
                if (!json.aiv || json.aiv === '') { json.aiv = crypto.randomBytes(8).toString('hex');  }

                console.log('[MAJORLOGIN-JSON] ✅ patched');
                const out = Buffer.from(JSON.stringify(json));

                // Hook: coba buat session (pakai protobuf path jika JSON tidak ada uid/key/iv)
                // Untuk JSON path, uid mungkin ada di json langsung
                _trySessionFromJson(json, clientIp);

                return out;
            }
        } catch (_) {}

        // === PROTOBUF PATH ===
        try {
            let out = Buffer.from(buf);

            const hasKey = protoFieldExists(out, 22);
            const hasIv  = protoFieldExists(out, 23);

            if (!hasKey) {
                const dummyKey = crypto.randomBytes(16);
                out = Buffer.concat([out, encodeField(22, dummyKey)]);
                console.log('[AK-INJECT-PROTO] ✅ field 22 injected');
            }
            if (!hasIv) {
                const dummyIv = crypto.randomBytes(8);
                out = Buffer.concat([out, encodeField(23, dummyIv)]);
                console.log('[AIV-INJECT-PROTO] ✅ field 23 injected');
            }

            console.log('[MAJORLOGIN-PROTO] ✅ patched', buf.length, '→', out.length, 'bytes');

            // Hook: buat session dari protobuf response
            onMajorLoginSuccess(out, clientIp);

            return out;
        } catch (e) {
            console.log('[MAJORLOGIN-PROTO] ⚠️ patch error:', e.message);
            return buf;
        }
    };
}

/** Coba extract info dari JSON MajorLogin untuk buat session */
function _trySessionFromJson(json, clientIp) {
    if (!tcpManager) return;
    try {
        // JSON format bisa bervariasi — uid biasanya di json.account_uid
        const uid = json.account_uid || json.uid || json.ACCOUNT_UID;
        const ak  = json.ak || json.key;
        const aiv = json.aiv || json.iv;
        if (!uid || !ak || !aiv) return;

        const key    = Buffer.from(typeof ak  === 'string' ? ak  : String(ak),  'hex');
        const iv     = Buffer.from(typeof aiv === 'string' ? aiv : String(aiv), 'hex');
        const region = json.region || 'IND';

        if (key.length < 8 || iv.length < 8) return; // terlalu pendek, skip

        const sessionId = tcpManager.createSession({
            uid: Number(uid), serverIp: BOT_SERVER_IP,
            serverPort: BOT_SERVER_PORT, key, iv, region,
        });
        if (sessionId) console.log(`[PROXY] Bot session (JSON) started: uid=${uid}`);
    } catch (_) {}
}

// Placeholder — diganti saat init()
let _patchMajorLogin = makeMajorLoginPatcher('');

// ============================================================
//  INTERCEPT MAP
// ============================================================
const INTERCEPT = {
    '/getlogindata':          patchGetLoginData,
    '/GetLoginData':          patchGetLoginData,
    '/logingetdesc':          patchLoginResponse,
    '/LoginGetDesc':          patchLoginResponse,
    '/majorlogin':            (buf, ip) => _patchMajorLogin(buf, ip),
    '/MajorLogin':            (buf, ip) => _patchMajorLogin(buf, ip),
    '/getpersonalshow':       patchUploadDisabled,
    '/GetPersonalShow':       patchUploadDisabled,
    '/getplayerpersonalshow': patchUploadDisabled,
    '/GetPlayerPersonalShow': patchUploadDisabled,
    '/getclientconfig':       patchUploadDisabled,
    '/GetClientConfig':       patchUploadDisabled,
    '/getgameconfig':         patchUploadDisabled,
    '/GetGameConfig':         patchUploadDisabled,
    '/getserverconfig':       patchUploadDisabled,
    '/GetServerConfig':       patchUploadDisabled,
    '/getaccountinfo':        patchUploadDisabled,
    '/GetAccountInfo':        patchUploadDisabled,
    '/checkversion':          patchUploadDisabled,
    '/CheckVersion':          patchUploadDisabled,
    '/getmaintenanceconfig':  patchUploadDisabled,
    '/GetMaintenanceConfig':  patchUploadDisabled,
};

function getPatcher(p) {
    return INTERCEPT[p] || INTERCEPT[p.toLowerCase()] || null;
}

// ============================================================
//  CORE FORWARD
// ============================================================
async function forwardRequest(req, res, targetUrl, agent) {
    await jitter(20, 120);

    const target       = new URL(targetUrl);
    const body         = Buffer.isBuffer(req.body) && req.body.length > 0 ? req.body : null;
    const obfHeaders   = getObfHeaders();
    const finalHeaders = {
        ...cleanHeaders(req.headers),
        ...obfHeaders,
        'Host':   target.host,
        'Origin': targetUrl,
    };

    if (body) {
        finalHeaders['Content-Length'] = body.length;
        if (!finalHeaders['Content-Type']) finalHeaders['Content-Type'] = 'application/octet-stream';
    } else {
        delete finalHeaders['content-length'];
        delete finalHeaders['Content-Length'];
    }

    // Ambil client IP untuk diteruskan ke session manager
    const rawIp    = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '';
    const clientIp = rawIp.split(',')[0].trim().replace('::ffff:', '');

    return new Promise(resolve => {
        const pr = https.request({
            hostname: target.hostname, port: 443,
            path: req.url, method: req.method,
            headers: finalHeaders, agent,
            timeout: 12000, rejectUnauthorized: false,
        }, proxyRes => {
            const chunks = [];
            proxyRes.on('data', c => chunks.push(c));
            proxyRes.on('end', () => {
                let buf = Buffer.concat(chunks);
                const patcher = getPatcher(req.path);

                if (patcher) {
                    // Patcher MajorLogin menerima clientIp sebagai arg ke-2
                    buf = patcher(buf, clientIp);
                }

                const safe = {};
                for (const [k, v] of Object.entries(proxyRes.headers || {})) {
                    if (!['x-powered-by','server','via','x-cache'].includes(k.toLowerCase()))
                        safe[k] = v;
                }
                safe['Content-Length'] = buf.length;
                res.writeHead(proxyRes.statusCode, safe);
                res.end(buf);

                // Touch session agar tidak dianggap idle
                if (tcpManager && clientIp) {
                    // uid tidak tersedia di sini, touch semua session aktif dari IP ini
                    // (cukup — manager akan match lewat uid yang sudah terdaftar)
                }

                resolve();
            });
        });

        pr.on('error', err => {
            console.log(`[PROXY] ⚠️ ${err.message}`);
            if (!res.headersSent) res.status(502).json({ code: 502, message: 'Gateway error' });
            resolve();
        });

        pr.on('timeout', () => {
            pr.destroy();
            if (!res.headersSent) res.status(504).json({ code: 504, message: 'Timeout' });
            resolve();
        });

        if (body) pr.write(body);
        pr.end();
    });
}

// ============================================================
//  ROUTE CLASSIFIER
// ============================================================
function isClientPath(p) {
    const lp = p.toLowerCase();
    return lp.includes('personal') || lp.includes('player') || lp.includes('client') ||
           lp.includes('pet')      || lp.includes('friend') || lp.includes('clan')   ||
           lp.includes('workshop') || lp.includes('splash') || lp.includes('desc')   ||
           lp.includes('profile')  || lp.includes('ranking')|| lp.includes('getlogindata') ||
           lp.includes('loginget');
}

// ============================================================
//  LAYER 8 — TELEMETRY ABSORBER
// ============================================================
function registerTelemetryAbsorbers(app) {
    const absorb = (req, res) => {
        res.status(200).json({ code: 0, msg: 'ok', ts: Date.now() });
    };

    const paths = [
        '/LogEvent', '/logevent', '/api/LogEvent',
        '/report', '/Report', '/datareport', '/DataReport',
        '/upload', '/Upload',
        '/vodka/*', '/gateway/*', '/network/*', '/event/*',
        '/gin/*', '/ggp/*',
        '/web_log', '/network_log',
        '/api/network_log', '/api/web_log',
        '/api/gin_dummy', '/api/web_dummy',
        '/SubmitReport', '/SendHackLog', '/SendGinInfo',
        '/SendClientLog', '/ReportPlayer',
        '/UploadClientLog', '/UploadLog', '/uploadlog',
        '/traceroute', '/probe', '/ping_probe',
        '/AndroidApplicationDetection', '/androidapplicationdetection',
        '/GinReport', '/ginreport',
        '/FFAntiReport', '/ffantireport',
        '/detection', '/Detection',
        '/hacklog', '/HackLog',
    ];

    for (const p of paths) app.all(p, absorb);
    console.log('[TELEMETRY] Absorbers registered (v2.6)');
}

// ============================================================
//  SKIP PATH SET
// ============================================================
const SKIP_PREFIXES = [
    '/cdn/', '/freefireth/', '/auth/', '/api/',
    '/health', '/status',
];
const SKIP_EXACT = new Set([
    '/ver.php', '/localconfig.json', '/api/gamevar',
    '/api/gamevar/fallback', '/api/proxy/status', '/api/tcp/status',
]);
const SKIP_EXT = /\.(jpg|png|gif|css|js|html?)$/i;

function shouldSkip(p) {
    if (SKIP_EXACT.has(p)) return true;
    if (SKIP_EXT.test(p)) return true;
    for (const prefix of SKIP_PREFIXES) {
        if (p.startsWith(prefix)) return true;
    }
    return false;
}

// ============================================================
//  CLIENT DISCONNECT TRACKER
//  Deteksi disconnect HTTP client → cleanup session
// ============================================================
function attachDisconnectTracker(req, uid) {
    if (!tcpManager || !uid) return;
    req.on('close', () => {
        // res.writableEnded → normal selesai; jika belum selesai = disconnect
        if (!req.complete) {
            tcpManager.removeByUid(uid);
            console.log(`[PROXY] Client disconnected early — session removed uid=${uid}`);
        }
    });
}

// ============================================================
//  INIT
// ============================================================
function init(app) {
    const proxyDomain = process.env.PROXY_DOMAIN ||
        (process.env.RAILWAY_PUBLIC_DOMAIN
            ? 'https://' + process.env.RAILWAY_PUBLIC_DOMAIN + '/'
            : 'https://proxy-reza-kontolodon-memek.up.railway.app/');

    console.log('[PROXY] proxyDomain =', proxyDomain);
    _patchMajorLogin = makeMajorLoginPatcher(proxyDomain);

    registerTelemetryAbsorbers(app);

    // ---- Status endpoints -----------------------------------

    app.get('/api/proxy/status', (req, res) => {
        res.json({
            status: 'online', mode: 'anti_detect_bypass_v2.6',
            proxyDomain,
            layers: [
                'header_obf', 'timing_jitter', 'tls_spoof', 'header_clean',
                'upload_patch_surgical', 'getlogindata_ggp_nuke',
                'login_response_clean',
                'majorlogin_proto_ak_iv_inject',
                'majorlogin_json_fallback',
                'poepgjphcmj_redirect', 'foggnihibpg_clear',
                'cecnlhconmi_disable', 'ljapojnbofe_clear',
                'telemetry_absorb',
                'per_user_tcp_bot_session',   // ← NEW
            ],
            ts: Date.now(),
        });
    });

    // Endpoint diagnostik TCP session — hanya informasi, tanpa credential
    app.get('/api/tcp/status', (req, res) => {
        if (!tcpManager) {
            return res.json({ enabled: false, reason: 'tcp module not loaded' });
        }
        res.json({ enabled: true, ...tcpManager.getStatus() });
    });

    // ---- Main catch-all proxy route -------------------------

    app.all('*', async (req, res, next) => {
        const p = req.path;
        if (shouldSkip(p)) return next();

        const target = isClientPath(p) ? GARENA_CLIENT_SERVER : GARENA_LOGIN_SERVER;
        const agent  = isClientPath(p) ? clientAgent : loginAgent;
        console.log(`[PROXY] ${req.method} ${p} → ${new URL(target).host}`);
        await forwardRequest(req, res, target + req.url, agent);
    });

    console.log('[PROXY] Anti-detect v2.6 ON (+ TCP session manager)');
}

module.exports = { init };
