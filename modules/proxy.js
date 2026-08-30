// modules/proxy.js — ANTI-DETECT BYPASS v2.3
// PATCH v2.3:
//   - Tambah /MajorLogin ke INTERCEPT map + patchMajorLogin() yang strip ban fields
//   - Tambah forwardAndAbsorb() untuk idevent.ggblueshark.com — intercept telemetry
//     yang dikirim langsung ke domain Garena (bukan lewat proxy) dan fake 200 ok
//   - Tambah ABSORB_DOMAINS: semua request ke idevent/vodka/gin/grtc langsung di-absorb
//   - patchMajorLogin: strip AEBBNFBNIDB (ban info), OBLLHDOLLGO (anti-addiction),
//     ak/aiv null prevention, ban_mode force ke 0
//   - Semua patcher sekarang juga handle case-insensitive path di INTERCEPT

const https  = require('https');
const crypto = require('crypto');

const GARENA_LOGIN_SERVER  = 'https://loginbp.ggblueshark.com';
const GARENA_CLIENT_SERVER = 'https://clientbp.ggpolarbear.com';

// ============================================================
//  LAYER 1 — USER-AGENT + HEADER POOL
// ============================================================
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
            out[i + 1] = 0x01;
            hit = true;
            i++;
        }
        if (fieldNum === 9 && out[i + 1] === 0x01) {
            out[i + 1] = 0x00;
            hit = true;
            i++;
        }
    }
    if (hit) console.log('[PATCH] ✅ upload-disabled flipped (surgical)');
    return out;
}

// ============================================================
//  LAYER 6 — GetLoginData GGP/CECNLHCONMI NUKE
// ============================================================
function patchGetLoginData(buf) {
    if (!Buffer.isBuffer(buf) || !buf.length) return buf;
    try {
        const str = buf.toString('utf-8');
        if (!str.trim().startsWith('{')) return buf;
        const json = JSON.parse(str);

        if (json.CECNLHCONMI) {
            json.CECNLHCONMI = {
                is_report_to_ggp:   false,
                ggp_url:            '',
                ut_flag:            0,
                is_transfer_report: false,
                is_enable_ggp:      false,
                content:            '',
                is_get_feature:     false,
                is_get_flag:        false,
                is_enable_tcp:      false,
            };
            console.log('[GGP-NUKE] ✅ CECNLHCONMI patched');
        }

        if (json.FOGGNIHIBPG) { json.FOGGNIHIBPG = [];  console.log('[TRACE-NUKE] ✅ traceroute cleared'); }
        if (json.LJAPOJNBOFE) { json.LJAPOJNBOFE = '';  console.log('[GRTC-NUKE] ✅ GRTC cleared'); }
        if (json.EMFPDECPCDG) json.EMFPDECPCDG = '';
        if (json.POEPGJPHCMJ) json.POEPGJPHCMJ = '';
        if (json.PDJHKBDIHGL) json.PDJHKBDIHGL = '';
        if (json.IIPKMIOFCJP) json.IIPKMIOFCJP = '';
        if (json.DEVICECHECK)  { json.DEVICECHECK  = null; console.log('[DCHECK-NUKE] ✅ DEVICECHECK stripped'); }
        if (json.GGPCHECKHASH) { json.GGPCHECKHASH = '';   console.log('[HASH-NUKE] ✅ GGPCHECKHASH stripped'); }

        return Buffer.from(JSON.stringify(json));
    } catch (e) {
        return buf;
    }
}

// ============================================================
//  LAYER 7 — LOGIN RESPONSE CLEANER (LoginGetDesc, etc)
// ============================================================
function patchLoginResponse(buf) {
    if (!Buffer.isBuffer(buf) || !buf.length) return buf;
    try {
        const str = buf.toString('utf-8');
        if (!str.trim().startsWith('{')) return buf;
        const json = JSON.parse(str);

        const NUKE_FIELDS = [
            'GGPCHECKHASH', 'DEVICECHECK', 'GGPCONFIG',
            'ANTIADDICTION', 'JAILBREAK_DETECTED',
            'ROOT_DETECTED',  'EMULATOR_DETECTED',
            'HOOK_DETECTED',  'MODIFIER_DETECTED',
        ];

        let hit = false;
        for (const f of NUKE_FIELDS) {
            if (json[f] !== undefined) {
                json[f] = typeof json[f] === 'string' ? '' : (typeof json[f] === 'boolean' ? false : null);
                hit = true;
            }
        }

        if (hit) console.log('[LOGIN-CLEAN] ✅ Anti-cheat flags stripped from login response');
        return Buffer.from(JSON.stringify(json));
    } catch (e) {
        return buf;
    }
}

// ============================================================
//  PATCH v2.3 — MAJORLOGIN BAN PATCHER
//  Root cause #2: MajorLogin response bawa AEBBNFBNIDB (ban_mode != 0)
//  dan ak/aiv null → client nunjukin UIAccountForbiddenPopWndController
//  Fix: force ban_mode=0, strip detection flags, inject dummy ak/aiv
// ============================================================
function patchMajorLogin(buf) {
    if (!Buffer.isBuffer(buf) || !buf.length) return buf;
    try {
        const str = buf.toString('utf-8');
        if (!str.trim().startsWith('{')) return buf;
        const json = JSON.parse(str);

        // Force ban info ke clean state
        // AEBBNFBNIDB = ban_mode object dari server
        if (json.AEBBNFBNIDB !== undefined) {
            json.AEBBNFBNIDB = {
                ban_mode:           0,
                unban_time:         0,
                history_update_ts:  Math.floor(Date.now() / 1000),
                history_seconds:    0,
                hint_string:        '',
                play_time:          0,
                guardian_setting:   null,
            };
            console.log('[BAN-NUKE] ✅ AEBBNFBNIDB ban_mode forced to 0');
        }

        // OBLLHDOLLGO = anti-addiction config — force semua switch off
        if (json.OBLLHDOLLGO !== undefined && json.OBLLHDOLLGO.anti_addiction_switch_desc) {
            json.OBLLHDOLLGO.anti_addiction_switch_desc.function_switch = false;
            json.OBLLHDOLLGO.anti_addiction_switch_desc.children_group  = false;
            json.OBLLHDOLLGO.anti_addiction_switch_desc.skip            = true;
            console.log('[ANTI-ADD-NUKE] ✅ anti_addiction_switch_desc disabled');
        }

        // Strip detection/check fields dari login response
        const NUKE_FIELDS = [
            'GGPCHECKHASH', 'DEVICECHECK', 'GGPCONFIG',
            'ANTIADDICTION', 'JAILBREAK_DETECTED',
            'ROOT_DETECTED', 'EMULATOR_DETECTED',
            'HOOK_DETECTED', 'MODIFIER_DETECTED',
        ];
        for (const f of NUKE_FIELDS) {
            if (json[f] !== undefined) {
                json[f] = typeof json[f] === 'string' ? '' : (typeof json[f] === 'boolean' ? false : null);
            }
        }

        // Jika ak/aiv null (ban signal) → inject dummy value
        // ServiceConnectionManager log "Get ak or aiv is null from backend!"
        if (json.ak  === null || json.ak  === undefined || json.ak  === '') {
            json.ak  = crypto.randomBytes(16).toString('hex');
            console.log('[AK-INJECT] ✅ ak injected');
        }
        if (json.aiv === null || json.aiv === undefined || json.aiv === '') {
            json.aiv = crypto.randomBytes(8).toString('hex');
            console.log('[AIV-INJECT] ✅ aiv injected');
        }

        console.log('[MAJORLOGIN-PATCH] ✅ MajorLogin response patched');
        return Buffer.from(JSON.stringify(json));
    } catch (e) {
        console.log('[MAJORLOGIN-PATCH] ⚠️ parse error:', e.message);
        return buf;
    }
}

// ============================================================
//  INTERCEPT MAP
// ============================================================
const INTERCEPT = {
    '/getlogindata':                patchGetLoginData,
    '/GetLoginData':                patchGetLoginData,
    '/logingetdesc':                patchLoginResponse,
    '/LoginGetDesc':                patchLoginResponse,
    // PATCH v2.3: MajorLogin sekarang di-patch
    '/majorlogin':                  patchMajorLogin,
    '/MajorLogin':                  patchMajorLogin,
    '/getpersonalshow':             patchUploadDisabled,
    '/GetPersonalShow':             patchUploadDisabled,
    '/getplayerpersonalshow':       patchUploadDisabled,
    '/GetPlayerPersonalShow':       patchUploadDisabled,
    '/getclientconfig':             patchUploadDisabled,
    '/GetClientConfig':             patchUploadDisabled,
    '/getgameconfig':               patchUploadDisabled,
    '/GetGameConfig':               patchUploadDisabled,
    '/getserverconfig':             patchUploadDisabled,
    '/GetServerConfig':             patchUploadDisabled,
    '/getaccountinfo':              patchUploadDisabled,
    '/GetAccountInfo':              patchUploadDisabled,
    '/checkversion':                patchUploadDisabled,
    '/CheckVersion':                patchUploadDisabled,
    '/getmaintenanceconfig':        patchUploadDisabled,
    '/GetMaintenanceConfig':        patchUploadDisabled,
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
                if (patcher) buf = patcher(buf);

                const safe = {};
                for (const [k, v] of Object.entries(proxyRes.headers || {})) {
                    if (!['x-powered-by', 'server', 'via', 'x-cache'].includes(k.toLowerCase()))
                        safe[k] = v;
                }
                safe['Content-Length'] = buf.length;

                res.writeHead(proxyRes.statusCode, safe);
                res.end(buf);
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

    app.all('/LogEvent',          absorb);
    app.all('/logevent',          absorb);
    app.all('/api/LogEvent',      absorb);
    app.all('/report',            absorb);
    app.all('/Report',            absorb);
    app.all('/datareport',        absorb);
    app.all('/DataReport',        absorb);
    app.all('/upload',            absorb);
    app.all('/Upload',            absorb);
    app.all('/vodka/*',           absorb);
    app.all('/gateway/*',         absorb);
    app.all('/network/*',         absorb);
    app.all('/event/*',           absorb);
    app.all('/gin/*',             absorb);
    app.all('/ggp/*',             absorb);
    app.all('/web_log',           absorb);
    app.all('/network_log',       absorb);
    app.all('/api/network_log',   absorb);
    app.all('/api/web_log',       absorb);
    app.all('/api/gin_dummy',     absorb);
    app.all('/api/web_dummy',     absorb);
    app.all('/SubmitReport',      absorb);
    app.all('/SendHackLog',       absorb);
    app.all('/SendGinInfo',       absorb);
    app.all('/SendClientLog',     absorb);
    app.all('/ReportPlayer',      absorb);
    app.all('/UploadClientLog',   absorb);
    app.all('/UploadLog',         absorb);
    app.all('/uploadlog',         absorb);
    app.all('/traceroute',        absorb);
    app.all('/probe',             absorb);
    app.all('/ping_probe',        absorb);
    // PATCH v2.3: tambah endpoint deteksi aplikasi
    app.all('/AndroidApplicationDetection', absorb);
    app.all('/androidapplicationdetection', absorb);
    app.all('/api/gin_dummyNetworkLogEvent', absorb);
    app.all('/GinReport',         absorb);
    app.all('/ginreport',         absorb);
    app.all('/FFAntiReport',      absorb);
    app.all('/ffantireport',      absorb);

    console.log('[TELEMETRY] All absorbers registered (v2.3)');
}

// ============================================================
//  PATCH v2.3 — EXTERNAL TELEMETRY INTERCEPTOR
//  Root cause #1: game ngirim EventTypeAndroidApplicationDetection
//  langsung ke idevent.ggblueshark.com (bukan lewat proxy)
//  Fix: intercept di ver.php response — redirect network_log_server
//       dan web_log_server ke proxy domain kita sendiri
//  Ini handle di gamevar.js (MY_IP + 'api/gin_dummy')
//  Tapi juga perlu handle kalau ada request ke domain lain yang lolos
// ============================================================

// ============================================================
//  SKIP PATH SET
// ============================================================
const SKIP_PREFIXES = [
    '/cdn/', '/freefireth/', '/auth/', '/api/',
    '/health', '/status',
];
const SKIP_EXACT = new Set([
    '/ver.php', '/localconfig.json', '/api/gamevar',
    '/api/gamevar/fallback', '/api/proxy/status',
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
//  INIT
// ============================================================
function init(app) {
    registerTelemetryAbsorbers(app);

    app.get('/api/proxy/status', (req, res) => {
        res.json({
            status: 'online', mode: 'anti_detect_bypass_v2.3',
            layers: [
                'header_obf', 'timing_jitter', 'tls_spoof', 'header_clean',
                'upload_patch_surgical', 'getlogindata_ggp_nuke',
                'login_response_clean', 'majorlogin_ban_patch',
                'telemetry_absorb', 'app_detection_absorb',
            ],
            targets: { login: GARENA_LOGIN_SERVER, client: GARENA_CLIENT_SERVER },
            ts: Date.now(),
        });
    });

    app.all('*', async (req, res, next) => {
        const p = req.path;
        if (shouldSkip(p)) return next();

        const target = isClientPath(p) ? GARENA_CLIENT_SERVER : GARENA_LOGIN_SERVER;
        const agent  = isClientPath(p) ? clientAgent : loginAgent;
        console.log(`[PROXY] ${req.method} ${p} → ${new URL(target).host}`);
        await forwardRequest(req, res, target + req.url, agent);
    });

    console.log('[PROXY] Anti-detect v2.3 ON');
    console.log('[PROXY] Layers: header_obf|jitter|tls|clean|upload_patch_surgical|ggp_nuke|login_clean|majorlogin_ban_patch|telemetry_absorb|app_detection_absorb');
}

module.exports = { init };
