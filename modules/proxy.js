// modules/proxy.js — ANTI-DETECT BYPASS v2.1
// FIX:
//   - Content-Length di-update SETELAH patcher modifikasi buffer (bukan sebelum)
//   - Telemetry absorbers konsolidasi (hapus duplikat dari gamevar.js)
//   - Route skip list di catch-all diperketat (tambah /api/proxy/, /health)
//   - Body bisa empty string → guard lebih ketat (Buffer.isBuffer + length > 0)
// Layers: header_obf | timing_jitter | tls_spoof | header_clean
//       | upload_patch | GetLoginData GGP nuke | idevent absorb
//       | grtc/RTC absorb | gateway absorb

const https = require('https');

const GARENA_LOGIN_SERVER  = 'https://loginbp.ggblueshark.com';
const GARENA_CLIENT_SERVER = 'https://clientbp.ggpolarbear.com';

// ============================================================
//  LAYER 1 — USER-AGENT + HEADER POOL
// ============================================================
const UA_POOL = [
    ['Dalvik/2.1.0 (Linux; U; Android 11; SM-G998B Build/RP1A.200720.012)',   'id-ID,en;q=0.9'],
    ['Dalvik/2.1.0 (Linux; U; Android 12; M2010J19SG Build/SKQ1.210908.001)','id-ID,en-US;q=0.8'],
    ['Dalvik/2.1.0 (Linux; U; Android 13; CPH2269 Build/TP1A.220624.014)',   'id-ID,en;q=0.7'],
    ['Dalvik/2.1.0 (Linux; U; Android 12; V2204 Build/SP1A.210812.016)',      'en-US,id;q=0.9'],
    ['Dalvik/2.1.0 (Linux; U; Android 11; RMX2151 Build/RP1A.200720.011)',   'id-ID'],
    ['Dalvik/2.1.0 (Linux; U; Android 14; Pixel 7 Build/UQ1A.231205.015)',   'en-US,id-ID;q=0.8'],
    ['Dalvik/2.1.0 (Linux; U; Android 13; 22111317G Build/TKQ1.221013.002)', 'id-ID,zh-TW;q=0.6'],
    ['Dalvik/2.1.0 (Linux; U; Android 12; ASUS_AI2201_B Build/SP1A.210812.016)','id-ID,en;q=0.9'],
];
const ENC_POOL  = ['gzip, deflate','gzip','gzip, deflate, br','deflate, gzip'];
const CONN_POOL = ['keep-alive','close','keep-alive'];

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
    };
}

// ============================================================
//  LAYER 2 — TIMING JITTER
// ============================================================
const jitter = (lo = 10, hi = 60) => new Promise(r => setTimeout(r, lo + Math.random() * (hi - lo)));

// ============================================================
//  LAYER 3 — TLS AGENT SPOOF
// ============================================================
function makeAgent(host) {
    return new https.Agent({
        host, keepAlive: true,
        keepAliveMsecs:      3000 + Math.floor(Math.random() * 2000),
        maxSockets:          8,
        rejectUnauthorized:  false,
        ciphers: [
            'TLS_AES_128_GCM_SHA256','TLS_AES_256_GCM_SHA384',
            'TLS_CHACHA20_POLY1305_SHA256','ECDHE-ECDSA-AES128-GCM-SHA256',
            'ECDHE-RSA-AES128-GCM-SHA256','ECDHE-ECDSA-AES256-GCM-SHA384',
            'ECDHE-RSA-AES256-GCM-SHA384',
        ].join(':'),
        honorCipherOrder: false,
        minVersion: 'TLSv1.2', maxVersion: 'TLSv1.3',
        ALPNProtocols: ['http/1.1'],
        sessionTimeout: 300,
    });
}

const loginAgent  = makeAgent('loginbp.ggblueshark.com');
const clientAgent = makeAgent('clientbp.ggpolarbear.com');

// ============================================================
//  LAYER 4 — HEADER CLEANER
// ============================================================
const STRIP_REQ = new Set([
    'x-forwarded-for','x-forwarded-host','x-forwarded-proto','x-real-ip',
    'via','forwarded','proxy-connection','x-envoy-peer-metadata',
    'x-envoy-upstream-service-time','cf-connecting-ip','cf-ray',
    'x-vercel-id','x-amzn-trace-id','x-cache','x-served-by',
]);

function cleanHeaders(h) {
    const o = {};
    for (const [k, v] of Object.entries(h))
        if (!STRIP_REQ.has(k.toLowerCase())) o[k] = v;
    return o;
}

// ============================================================
//  LAYER 5 — UPLOAD-DISABLED PATCH (protobuf byte flip)
// ============================================================
function patchUploadDisabled(buf) {
    if (!Buffer.isBuffer(buf) || !buf.length) return buf;
    const out = Buffer.from(buf); let hit = false;
    for (let i = 0; i < out.length - 1; i++) {
        if (out[i] === 0x08 && out[i+1] === 0x00) { out[i+1] = 0x01; hit = true; }
        if (out[i] === 0x10 && out[i+1] === 0x00) { out[i+1] = 0x01; hit = true; }
        if (out[i] === 0x40 && out[i+1] === 0x00) { out[i+1] = 0x01; hit = true; }
        if (out[i] === 0x48 && out[i+1] === 0x01) { out[i+1] = 0x00; hit = true; }
    }
    if (hit) console.log('[PATCH] ✅ upload-disabled flipped');
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

        if (json.FOGGNIHIBPG) { json.FOGGNIHIBPG = []; console.log('[TRACE-NUKE] ✅ traceroute list cleared'); }
        if (json.LJAPOJNBOFE) { json.LJAPOJNBOFE = ''; console.log('[GRTC-NUKE] ✅ GRTC server string cleared'); }
        if (json.EMFPDECPCDG) json.EMFPDECPCDG = '';
        if (json.POEPGJPHCMJ) json.POEPGJPHCMJ = '';
        if (json.PDJHKBDIHGL) json.PDJHKBDIHGL = '';
        if (json.IIPKMIOFCJP) json.IIPKMIOFCJP = '';

        return Buffer.from(JSON.stringify(json));
    } catch (e) {
        return buf; // bukan JSON (protobuf), skip
    }
}

// ============================================================
//  INTERCEPT MAP
// ============================================================
const INTERCEPT = {
    '/getlogindata':          patchGetLoginData,
    '/getpersonalshow':       patchUploadDisabled,
    '/getplayerpersonalshow': patchUploadDisabled,
    '/getclientconfig':       patchUploadDisabled,
    '/getgameconfig':         patchUploadDisabled,
    '/getserverconfig':       patchUploadDisabled,
    '/getaccountinfo':        patchUploadDisabled,
    '/checkversion':          patchUploadDisabled,
    '/getmaintenanceconfig':  patchUploadDisabled,
    '/logingetdesc':          patchUploadDisabled,
};

function getPatcher(p) {
    return INTERCEPT[p.toLowerCase()] || null;
}

// ============================================================
//  CORE FORWARD
//  FIX: Content-Length di-set SETELAH patch (buf mungkin berubah ukuran)
// ============================================================
async function forwardRequest(req, res, targetUrl, agent) {
    await jitter(10, 60);

    const target       = new URL(targetUrl);
    const body         = Buffer.isBuffer(req.body) && req.body.length > 0 ? req.body : null;
    const obfHeaders   = getObfHeaders();
    const finalHeaders = {
        ...cleanHeaders(req.headers),
        ...obfHeaders,
        'Host':   target.host,
        'Origin': targetUrl,
    };

    // Body header — set sebelum request
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

                // Apply patcher
                const patcher = getPatcher(req.path);
                if (patcher) buf = patcher(buf);

                // Build safe response headers
                const safe = {};
                for (const [k, v] of Object.entries(proxyRes.headers || {})) {
                    if (!['x-powered-by','server','via','x-cache'].includes(k.toLowerCase()))
                        safe[k] = v;
                }
                // FIX: Content-Length di-update SETELAH patcher (ukuran bisa beda)
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
//  LAYER 7 — TELEMETRY ABSORBER (konsolidasi — satu tempat)
//  FIX: registerDummyEndpoints di gamevar.js sudah diperkecil
//       (hanya /api/gin_dummy dan /api/web_dummy).
//       Semua absorber lain ada di sini.
// ============================================================
function registerTelemetryAbsorbers(app) {
    const absorb = (req, res) => {
        res.status(200).json({ code: 0, msg: 'ok', ts: Date.now() });
    };

    // idevent.ggblueshark.com
    app.all('/LogEvent',         absorb);
    app.all('/logevent',         absorb);
    app.all('/api/LogEvent',     absorb);

    // ff.dr.grtc.garenanow.com
    app.all('/report',           absorb);
    app.all('/Report',           absorb);
    app.all('/datareport',       absorb);
    app.all('/DataReport',       absorb);

    // vodka.freefiremobile.com
    app.all('/upload',           absorb);
    app.all('/Upload',           absorb);
    app.all('/vodka/*',          absorb);

    // sggigateway / idnetwork / idevent
    app.all('/gateway/*',        absorb);
    app.all('/network/*',        absorb);
    app.all('/event/*',          absorb);

    // GIN / GGP (semua prefix)
    app.all('/gin/*',            absorb);
    app.all('/ggp/*',            absorb);
    app.all('/web_log',          absorb);
    app.all('/network_log',      absorb);
    app.all('/api/network_log',  absorb);
    app.all('/api/web_log',      absorb);
    app.all('/api/gin_dummy',    absorb);
    app.all('/api/web_dummy',    absorb);

    // Ingame report / upload log
    app.all('/SubmitReport',     absorb);
    app.all('/SendHackLog',      absorb);
    app.all('/SendGinInfo',      absorb);
    app.all('/SendClientLog',    absorb);
    app.all('/ReportPlayer',     absorb);
    app.all('/UploadClientLog',  absorb);
    app.all('/UploadLog',        absorb);
    app.all('/uploadlog',        absorb);

    // Traceroute / network probe
    app.all('/traceroute',       absorb);
    app.all('/probe',            absorb);
    app.all('/ping_probe',       absorb);

    console.log('[TELEMETRY] All absorbers registered (idevent, grtc, vodka, gin, ggp, gateway)');
}

// ============================================================
//  SKIP PATH SET — path yang GA di-forward ke Garena
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
    // Layer 7 first — absorbers priority tinggi
    registerTelemetryAbsorbers(app);

    app.get('/api/proxy/status', (req, res) => {
        res.json({
            status: 'online', mode: 'anti_detect_bypass_v2.1',
            layers: [
                'header_obf','timing_jitter','tls_spoof','header_clean',
                'upload_patch','getlogindata_ggp_nuke','telemetry_absorb',
            ],
            targets: { login: GARENA_LOGIN_SERVER, client: GARENA_CLIENT_SERVER },
            ts: Date.now(),
        });
    });

    // Catch-all forward
    app.all('*', async (req, res, next) => {
        const p = req.path;
        if (shouldSkip(p)) return next();

        const target = isClientPath(p) ? GARENA_CLIENT_SERVER : GARENA_LOGIN_SERVER;
        const agent  = isClientPath(p) ? clientAgent : loginAgent;
        console.log(`[PROXY] ${req.method} ${p} → ${new URL(target).host}`);
        await forwardRequest(req, res, target + req.url, agent);
    });

    console.log('[PROXY] Anti-detect v2.1 ON');
    console.log('[PROXY] Layers: header_obf|jitter|tls|clean|upload_patch|ggp_nuke|telemetry_absorb');
}

module.exports = { init };
