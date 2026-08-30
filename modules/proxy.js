// modules/proxy.js — ANTI-DETECT BYPASS v2.4
// PATCH v2.4 — Fix root causes dari log 14:42:
//   - patchMajorLogin: tambah patch POEPGJPHCMJ → redirect idevent ke proxy
//   - patchMajorLogin: nuke FOGGNIHIBPG (traceroute list)
//   - patchMajorLogin: nuke CECNLHCONMI (GGP) + LJAPOJNBOFE (GRTC)
//   - patchMajorLogin: nuke EMFPDECPCDG, POEPGJPHCMJ, PDJHKBDIHGL, IIPKMIOFCJP
//   - MY_DOMAIN auto-detect dari Host header request

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
//  HELPER — nuke field anticheat yang ada di berbagai response
// ============================================================
function nukeCommonFields(json, proxyDomain) {
    // GGP: disable semua
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
        console.log('[GGP-NUKE] ✅ CECNLHCONMI disabled');
    }

    // GRTC: kosongkan agar SDK ga konek ke Garena
    if (json.LJAPOJNBOFE !== undefined) {
        json.LJAPOJNBOFE = '';
        console.log('[GRTC-NUKE] ✅ LJAPOJNBOFE cleared');
    }

    // Traceroute list: kosongkan
    if (json.FOGGNIHIBPG !== undefined) {
        json.FOGGNIHIBPG = [];
        console.log('[TRACE-NUKE] ✅ FOGGNIHIBPG cleared');
    }

    // Event/network server URLs: redirect ke proxy atau kosongkan
    // POEPGJPHCMJ = idevent URL — redirect ke proxy agar LogEvent lewat kita
    if (json.POEPGJPHCMJ !== undefined) {
        json.POEPGJPHCMJ = proxyDomain || '';
        console.log('[EVENT-REDIRECT] ✅ POEPGJPHCMJ → proxy');
    }
    if (json.EMFPDECPCDG !== undefined) { json.EMFPDECPCDG = ''; }
    if (json.PDJHKBDIHGL !== undefined) { json.PDJHKBDIHGL = ''; }
    if (json.IIPKMIOFCJP !== undefined) { json.IIPKMIOFCJP = ''; }

    // Device check fields
    if (json.DEVICECHECK  !== undefined) { json.DEVICECHECK  = null; }
    if (json.GGPCHECKHASH !== undefined) { json.GGPCHECKHASH = ''; }

    // Generic detection flags
    const NUKE = [
        'GGPCONFIG', 'ANTIADDICTION', 'JAILBREAK_DETECTED',
        'ROOT_DETECTED', 'EMULATOR_DETECTED', 'HOOK_DETECTED', 'MODIFIER_DETECTED',
    ];
    for (const f of NUKE) {
        if (json[f] !== undefined)
            json[f] = typeof json[f] === 'string' ? '' : (typeof json[f] === 'boolean' ? false : null);
    }
}

// ============================================================
//  PATCH v2.4 — MAJORLOGIN FULL NUKE
//  Fix semua yang ketahuan dari log 14:42:
//   - POEPGJPHCMJ masih idevent.ggblueshark.com → redirect ke proxy
//   - FOGGNIHIBPG traceroute masih ada → kosongkan
//   - CECNLHCONMI GGP masih enable → disable
//   - LJAPOJNBOFE GRTC masih ada → kosongkan
//   - AEBBNFBNIDB ban_mode → force 0
//   - ak/aiv null → inject dummy
// ============================================================
function makeMajorLoginPatcher(proxyDomain) {
    return function patchMajorLogin(buf) {
        if (!Buffer.isBuffer(buf) || !buf.length) return buf;
        try {
            const str = buf.toString('utf-8');
            if (!str.trim().startsWith('{')) return buf;
            const json = JSON.parse(str);

            // Nuke semua field anticheat + redirect event URL
            nukeCommonFields(json, proxyDomain);

            // Ban info: force clean
            if (json.AEBBNFBNIDB !== undefined) {
                json.AEBBNFBNIDB = {
                    ban_mode:          0,
                    unban_time:        0,
                    history_update_ts: Math.floor(Date.now() / 1000),
                    history_seconds:   0,
                    hint_string:       '',
                    play_time:         0,
                    guardian_setting:  null,
                };
                console.log('[BAN-NUKE] ✅ AEBBNFBNIDB ban_mode forced 0');
            }

            // Anti-addiction: disable
            if (json.OBLLHDOLLGO && json.OBLLHDOLLGO.anti_addiction_switch_desc) {
                json.OBLLHDOLLGO.anti_addiction_switch_desc.function_switch = false;
                json.OBLLHDOLLGO.anti_addiction_switch_desc.children_group  = false;
                json.OBLLHDOLLGO.anti_addiction_switch_desc.skip            = true;
                console.log('[ANTI-ADD] ✅ anti_addiction disabled');
            }

            // ak/aiv null prevention
            if (!json.ak  || json.ak  === '') { json.ak  = crypto.randomBytes(16).toString('hex'); console.log('[AK-INJECT] ✅'); }
            if (!json.aiv || json.aiv === '') { json.aiv = crypto.randomBytes(8).toString('hex');  console.log('[AIV-INJECT] ✅'); }

            console.log('[MAJORLOGIN] ✅ MajorLogin fully patched');
            return Buffer.from(JSON.stringify(json));
        } catch (e) {
            console.log('[MAJORLOGIN] ⚠️ parse error:', e.message);
            return buf;
        }
    };
}

// Placeholder patcher — akan diganti waktu init() dipanggil dengan domain yang benar
let _patchMajorLogin = makeMajorLoginPatcher('');

// ============================================================
//  INTERCEPT MAP
// ============================================================
const INTERCEPT = {
    '/getlogindata':          patchGetLoginData,
    '/GetLoginData':          patchGetLoginData,
    '/logingetdesc':          patchLoginResponse,
    '/LoginGetDesc':          patchLoginResponse,
    '/majorlogin':            (buf) => _patchMajorLogin(buf),
    '/MajorLogin':            (buf) => _patchMajorLogin(buf),
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

    const paths = [
        '/LogEvent', '/logevent', '/api/LogEvent',
        '/report', '/Report', '/datareport', '/DataReport',
        '/upload', '/Upload',
        '/vodka/*', '/gateway/*', '/network/*', '/event/*',
        '/gin/*', '/ggp/*',
        '/web_log', '/network_log',
        '/api/network_log', '/api/web_log',
        '/api/gin_dummy', '/api/web_dummy',
        '/api/gin_dummyNetworkLogEvent',
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
    console.log('[TELEMETRY] Absorbers registered (v2.4)');
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
    // Detect proxy domain dari env atau fallback ke Railway URL
    const proxyDomain = process.env.PROXY_DOMAIN ||
        (process.env.RAILWAY_PUBLIC_DOMAIN
            ? 'https://' + process.env.RAILWAY_PUBLIC_DOMAIN + '/'
            : 'https://proxy-reza-kontolodon-memek.up.railway.app/');

    console.log('[PROXY] proxyDomain =', proxyDomain);

    // Update MajorLogin patcher dengan domain yang sudah diketahui
    _patchMajorLogin = makeMajorLoginPatcher(proxyDomain);

    registerTelemetryAbsorbers(app);

    app.get('/api/proxy/status', (req, res) => {
        res.json({
            status: 'online', mode: 'anti_detect_bypass_v2.4',
            proxyDomain,
            layers: [
                'header_obf', 'timing_jitter', 'tls_spoof', 'header_clean',
                'upload_patch_surgical', 'getlogindata_ggp_nuke',
                'login_response_clean', 'majorlogin_full_nuke',
                'poepgjphcmj_redirect', 'foggnihibpg_clear',
                'cecnlhconmi_disable', 'ljapojnbofe_clear',
                'telemetry_absorb',
            ],
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

    console.log('[PROXY] Anti-detect v2.4 ON');
}

module.exports = { init };
