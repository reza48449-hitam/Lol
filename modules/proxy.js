'use strict';

const https  = require('https');
const crypto = require('crypto');

const GARENA_LOGIN_SERVER  = 'https://loginbp.ggblueshark.com';
const GARENA_CLIENT_SERVER = 'https://clientbp.ggpolarbear.com';

// ============================================================
//  LAYER 1 — HEADER OBFUSCATION
//  Rotasi UA + Accept-Language + minor headers
//  AMAN: tidak sentuh konten request/response sama sekali
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
//  Random delay kecil agar pola request tidak terlalu regular
//  AMAN: tidak ubah konten apapun
// ============================================================
const jitter = (lo = 20, hi = 120) =>
    new Promise(r => setTimeout(r, lo + Math.random() * (hi - lo)));

// ============================================================
//  LAYER 3 — TLS AGENT SPOOF
//  Cipher suite + ALPN yang mirip real Android client
//  AMAN: hanya pengaruhi TLS handshake, bukan payload
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
//  Strip proxy/forwarding headers agar tidak ketahuan lewat proxy
//  AMAN: hanya hapus header, tidak sentuh body
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
//  LAYER 5 — TELEMETRY ABSORBER
//  Semua endpoint log/report/anticheat upload → 200 OK palsu
//  AMAN: tidak manipulasi traffic game utama, hanya "sinkhole"
//  telemetry lokal agar tidak kirim data ke Garena
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
    console.log('[TELEMETRY] Absorbers registered');
}

// ============================================================
//  BAN DETECTOR — parse response untuk deteksi ban
//  Dipanggil setelah forward, lalu notify tcp manager
// ============================================================
let _tcpManager = null;

function setTcpManager(manager) {
    _tcpManager = manager;
}

// Coba deteksi ban dari response JSON Garena
// Field AEBBNFBNIDB.ban_mode != 0 = banned
function detectAndHandleBan(uid, buf) {
    if (!_tcpManager || !uid) return;
    try {
        const str = buf.toString('utf-8');
        if (!str.trim().startsWith('{')) return;
        const json = JSON.parse(str);

        const banInfo = json.AEBBNFBNIDB;
        if (banInfo && typeof banInfo.ban_mode === 'number' && banInfo.ban_mode !== 0) {
            console.log(`[BAN-DETECT] uid=${uid} ban_mode=${banInfo.ban_mode} — removing session`);
            _tcpManager.handleBannedUid(uid, banInfo.ban_mode);
        }
    } catch (_) {}
}

// ============================================================
//  CORE FORWARD — pure pass-through, tidak patch apapun
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

    // Ambil uid dari session untuk ban detection
    const uid = req.session?.uid || null;

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
                const buf = Buffer.concat(chunks);

                // Cek ban di response login/majorlogin — tidak modify buf
                const p = req.path.toLowerCase();
                if (p.includes('majorlogin') || p.includes('getlogindata')) {
                    detectAndHandleBan(uid, buf);
                }

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
    const proxyDomain = process.env.PROXY_DOMAIN ||
        (process.env.RAILWAY_PUBLIC_DOMAIN
            ? 'https://' + process.env.RAILWAY_PUBLIC_DOMAIN + '/'
            : 'https://proxy-reza-kontolodon-memek.up.railway.app/');

    console.log('[PROXY] proxyDomain =', proxyDomain);

    registerTelemetryAbsorbers(app);

    app.get('/api/proxy/status', (req, res) => {
        res.json({
            status: 'online', mode: 'clean_proxy_v3',
            proxyDomain,
            layers: [
                'header_obf',       // Layer 1: UA rotation
                'timing_jitter',    // Layer 2: random delay
                'tls_spoof',        // Layer 3: cipher/ALPN
                'header_clean',     // Layer 4: strip proxy headers
                'telemetry_absorb', // Layer 5: sinkhole log endpoints
                'ban_detect',       // Bonus: auto-cleanup session jika ban
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

    console.log('[PROXY] Clean proxy v3 ON — no response patching');
}

module.exports = { init, setTcpManager };
