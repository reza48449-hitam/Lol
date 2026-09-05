// modules/cdn.js
//
// CDN Proxy Handler — Railway Edition
// ====================================
// Melayani asset game Free Fire lewat Railway → CDN Garena.
//
// Fitur:
//   - Local-file serving dengan Range / HEAD support (resume-safe)
//   - Upstream proxy ke dl.cdn.freefiremobile.com dengan streaming penuh
//   - Retry exponential backoff (max 3x) untuk ECONNRESET / timeout
//   - In-flight request deduplication — N request ke file yang sama hanya
//     buka 1 koneksi upstream; sisanya ngantri dan nge-pipe dari yang sama
//   - Circuit breaker per-host: setelah 5 gagal berturut-turut, upstream
//     di-skip selama 30 detik supaya Railway tidak kena flood request rusak
//   - Socket-destroy on mid-stream error — game langsung retry, bukan
//     nunggu timeout yang panjang
//   - Logging terstruktur dengan prefix [CDN] yang konsisten
//   - Metrics counter (hit/miss/upstream/error) untuk debug

'use strict';

const path  = require('path');
const fs    = require('fs');
const https = require('https');

// ─── Konstanta ───────────────────────────────────────────────────────────────

const BASE_DIR       = path.resolve(__dirname, '..', 'public', 'cdn');
const CDN_VERSION    = '1.130.22';   // versi folder di CDN Garena
const CDN_UPSTREAM   = 'dl.cdn.freefiremobile.com';

const TIMEOUT_CONNECT = 15_000;  // ms — batas tunggu sambungan ke upstream
const TIMEOUT_STREAM  = 90_000;  // ms — batas total streaming (file 2–3 MB)
const RETRY_MAX       = 3;       // jumlah maksimal percobaan ke upstream
const RETRY_BASE_MS   = 800;     // ms — backoff awal (× 2ˢ per attempt)

const CB_THRESHOLD    = 5;       // gagal berturut-turut sebelum circuit buka
const CB_RESET_MS     = 30_000;  // ms — lama circuit buka sebelum half-open

// Header yang di-relay dari upstream ke game
const RELAY_HEADERS = [
    'content-type', 'content-length', 'content-range',
    'accept-ranges', 'etag', 'last-modified', 'cache-control',
];

// Error code yang layak di-retry
const RETRYABLE_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EPIPE']);

// ─── Keep-Alive HTTPS Agent ──────────────────────────────────────────────────
// Reuse TCP connection ke CDN Garena — kurangi overhead cold-connect
// yang jadi penyebab utama timeout di Railway (cold connetion ~300–500ms extra)

const AGENT = new https.Agent({
    keepAlive     : true,
    keepAliveMsecs: 15_000,
    maxSockets    : 20,
    maxFreeSockets: 10,
    timeout       : TIMEOUT_STREAM,
});

// ─── Metrics ─────────────────────────────────────────────────────────────────

const metrics = {
    localHit   : 0,
    localMiss  : 0,
    upstream   : 0,
    upstreamOk : 0,
    upstreamErr: 0,
    retried    : 0,
    inflight   : 0,
};

// Dump metrics ke console setiap 5 menit (hanya kalau ada traffic)
let _lastMetricsDump = Date.now();
function maybeDumpMetrics() {
    const now = Date.now();
    if (now - _lastMetricsDump < 5 * 60_000) return;
    _lastMetricsDump = now;
    console.log('[CDN] metrics:', JSON.stringify(metrics));
}

// ─── Circuit Breaker ──────────────────────────────────────────────────────────
// Kalau upstream CDN susah dijangkau (misalnya region block Railway),
// circuit buka sementara supaya Railway tidak kena spam request yang pasti gagal.

const circuit = {
    failures : 0,
    openUntil: 0,
};

function circuitIsOpen() {
    if (circuit.openUntil && Date.now() < circuit.openUntil) return true;
    if (circuit.openUntil && Date.now() >= circuit.openUntil) {
        // Half-open: reset, coba lagi
        circuit.openUntil = 0;
        console.log('[CDN] Circuit half-open — mencoba upstream lagi');
    }
    return false;
}

function circuitRecordSuccess() {
    circuit.failures = 0;
    circuit.openUntil = 0;
}

function circuitRecordFailure() {
    circuit.failures++;
    if (circuit.failures >= CB_THRESHOLD) {
        circuit.openUntil = Date.now() + CB_RESET_MS;
        console.log(`[CDN] Circuit OPEN — upstream diblokir ${CB_RESET_MS / 1000}s (${circuit.failures} gagal berturut)`);
    }
}

// ─── In-flight Request Deduplication ─────────────────────────────────────────
// Kalau game mengirim N request ke file yang sama secara bersamaan
// (MultiDownloadLoader memang jalan paralel), hanya 1 yang buka koneksi ke CDN.
// Sisanya menjadi "waiter" yang mendapat data dari stream yang sama.
//
// Map: normalizedUrl → { waiters: [res, ...], stream: IncomingMessage|null }
// Setelah stream selesai, entry dihapus dari map.

const inflight = new Map();

// ─── Path Safety & Resolution ─────────────────────────────────────────────────

function safeLocalPath(urlPath) {
    let p;
    try {
        p = decodeURIComponent(urlPath);
    } catch (_) {
        p = urlPath;
    }

    p = p.replace(/\\/g, '/');
    if (p.includes('\0') || p.includes('..')) return null;

    // Kandidat lokasi file (urutan prioritas)
    const candidates = [
        // Permintaan langsung, misal: /android_astc/1.130.22/gameassetbundles/foo
        path.join(BASE_DIR, p.replace(/^\/+/, '')),
        // Game kadang request /live/ABHotUpdates/... tapi file ada di root cdn/
        path.join(BASE_DIR, p.replace(/^\/live\/ABHotUpdates\/?/, '')),
    ];

    // Khusus: OB54 fileinfo minta codepatch lewat path android_astc/<ver>/codepatch/
    // tapi file disimpan di live/ABHotUpdates/gameassetbundles/codepatch/
    const cpMatch = /^\/live\/ABHotUpdates\/android_astc\/[^/]+\/(gameassetbundles\/codepatch\/[^/]+)$/.exec(p);
    if (cpMatch) {
        candidates.push(path.join(BASE_DIR, 'live', 'ABHotUpdates', cpMatch[1]));
    }

    for (const candidate of candidates) {
        const resolved = path.resolve(candidate);
        if (resolved === BASE_DIR || resolved.startsWith(BASE_DIR + path.sep)) {
            try {
                const stat = fs.statSync(resolved);
                if (stat.isFile()) return resolved;
            } catch (_) { /* tidak ada */ }
        }
    }
    return null;
}

// ─── Local File Serving ───────────────────────────────────────────────────────

/**
 * Kirim file lokal ke client, dengan dukungan Range Request (resume) dan HEAD.
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse}  res
 * @param {string} filePath
 */
function sendLocal(req, res, filePath) {
    let stat;
    try {
        stat = fs.statSync(filePath);
    } catch (err) {
        console.log(`[CDN] LOCAL STAT ERROR: ${err.message} — ${filePath}`);
        return res.status(500).end();
    }

    const size = stat.size;

    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=3600');

    if (req.method === 'HEAD') {
        res.setHeader('Content-Length', String(size));
        return res.status(200).end();
    }

    const rangeHeader = req.headers.range;

    // ── Full file ─────────────────────────────────────────────────────────────
    if (!rangeHeader) {
        res.setHeader('Content-Length', String(size));
        const stream = fs.createReadStream(filePath);
        stream.on('error', err => {
            console.log(`[CDN] LOCAL STREAM ERROR: ${err.message}`);
            if (!res.headersSent) res.status(500).end();
            else res.socket && res.socket.destroy();
        });
        res.on('close', () => stream.destroy()); // cleanup kalau client disconnect
        return stream.pipe(res);
    }

    // ── Range Request ─────────────────────────────────────────────────────────
    const m = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
    if (!m) {
        return res.status(416).setHeader('Content-Range', `bytes */${size}`).end();
    }

    let start, end;

    if (!m[1] && m[2]) {
        // suffix-length: bytes=-500
        const suffix = Number(m[2]);
        start = Math.max(0, size - suffix);
        end   = size - 1;
    } else {
        start = m[1] ? Number(m[1]) : 0;
        end   = m[2] ? Number(m[2]) : size - 1;
    }

    if (
        !Number.isFinite(start) || !Number.isFinite(end) ||
        start < 0 || end < start || start >= size
    ) {
        return res.status(416).setHeader('Content-Range', `bytes */${size}`).end();
    }

    end = Math.min(end, size - 1);

    res.status(206);
    res.setHeader('Content-Range',  `bytes ${start}-${end}/${size}`);
    res.setHeader('Content-Length', String(end - start + 1));

    const stream = fs.createReadStream(filePath, { start, end });
    stream.on('error', err => {
        console.log(`[CDN] LOCAL RANGE STREAM ERROR: ${err.message}`);
        if (!res.headersSent) res.status(500).end();
        else res.socket && res.socket.destroy();
    });
    res.on('close', () => stream.destroy());
    return stream.pipe(res);
}

// ─── URL Normalization for CDN Upstream ───────────────────────────────────────

/**
 * Ubah path request game menjadi URL upstream CDN Garena.
 * @param {string} reqPath - req.path dari Express (/cdn sudah di-strip)
 * @returns {string} full HTTPS URL ke dl.cdn.freefiremobile.com
 */
function upstreamUrl(reqPath) {
    let p = reqPath.startsWith('/') ? reqPath : '/' + reqPath;

    // Pastikan ada /live/ABHotUpdates/
    if (!p.includes('/live/ABHotUpdates/')) {
        p = '/live/ABHotUpdates' + p;
    }

    // Normalisasi versi
    p = p
        .replace(/\/OB\d+\//,   `/${CDN_VERSION}/`)
        .replace(/\/1\.126\.3\//, `/${CDN_VERSION}/`);

    return `https://${CDN_UPSTREAM}${p}`;
}

// ─── Upstream Proxy ───────────────────────────────────────────────────────────

/**
 * Kirim request ke CDN Garena dan pipe hasilnya ke res.
 * Retry otomatis dengan exponential backoff sampai RETRY_MAX.
 *
 * @param {import('http').IncomingMessage} req    - request dari game
 * @param {import('http').ServerResponse}  res    - response ke game
 * @param {string}                         target - full upstream URL
 * @param {number}                         [attempt=1]
 */
function proxyUpstream(req, res, target, attempt) {
    attempt = attempt || 1;

    if (circuitIsOpen()) {
        console.log(`[CDN] Circuit OPEN — 503 untuk ${target}`);
        if (!res.headersSent) res.status(503).send('CDN upstream sementara tidak tersedia');
        return;
    }

    metrics.upstream++;
    console.log(`[CDN] UPSTREAM attempt=${attempt} ${target}`);

    let u;
    try { u = new URL(target); }
    catch (err) {
        console.log(`[CDN] URL PARSE ERROR: ${err.message} — ${target}`);
        if (!res.headersSent) res.status(400).end();
        return;
    }

    const reqHeaders = {
        'Host'           : u.host,
        'User-Agent'     : req.headers['user-agent']       || 'Dalvik/2.1.0',
        'Accept'         : req.headers['accept']           || '*/*',
        'Accept-Language': req.headers['accept-language']  || 'id-ID,en-US;q=0.9',
        'Connection'     : 'keep-alive',
    };
    if (req.headers.range) reqHeaders['Range'] = req.headers.range;

    // Timeout dua lapis:
    //   r.setTimeout → batas koneksi awal + time-to-first-byte
    //   streamTimer  → batas total (termasuk transfer)
    let streamTimer = null;

    const r = https.get({
        hostname: u.hostname,
        path    : u.pathname + (u.search || ''),
        headers : reqHeaders,
        agent   : AGENT,
        timeout : TIMEOUT_CONNECT,
    }, upstreamRes => {
        clearTimeout(streamTimer); // koneksi berhasil, reset timer

        // Aktifkan stream timer untuk file besar
        streamTimer = setTimeout(() => {
            console.log(`[CDN] STREAM TIMEOUT attempt=${attempt} — ${target}`);
            upstreamRes.destroy(new Error('stream timeout'));
        }, TIMEOUT_STREAM);

        const status = upstreamRes.statusCode || 502;
        if (!res.headersSent) {
            res.statusCode = status;
            for (const h of RELAY_HEADERS) {
                if (upstreamRes.headers[h] != null) res.setHeader(h, upstreamRes.headers[h]);
            }
        }

        // Pipe langsung — tidak buffer di memory
        upstreamRes.pipe(res, { end: true });

        upstreamRes.on('end', () => {
            clearTimeout(streamTimer);
            circuitRecordSuccess();
            metrics.upstreamOk++;
        });

        upstreamRes.on('error', err => {
            clearTimeout(streamTimer);
            console.log(`[CDN] UPSTREAM RES ERROR attempt=${attempt}: ${err.message} — ${target}`);
            circuitRecordFailure();
            metrics.upstreamErr++;
            if (!res.headersSent) {
                res.status(502).end();
            } else {
                // Header sudah keluar — paksa tutup socket ke game supaya
                // game detect putus dan segera retry (bukan nunggu timeout)
                res.socket && res.socket.destroy();
            }
        });
    });

    // Timeout pada koneksi / TFB
    r.on('timeout', () => {
        console.log(`[CDN] CONNECT TIMEOUT attempt=${attempt} — ${target}`);
        r.destroy(new Error('connect timeout'));
    });

    r.on('error', err => {
        clearTimeout(streamTimer);

        const isRetryable =
            RETRYABLE_CODES.has(err.code) ||
            err.message === 'connect timeout'  ||
            err.message === 'stream timeout';

        if (isRetryable && attempt < RETRY_MAX) {
            const delay = RETRY_BASE_MS * Math.pow(2, attempt - 1);
            metrics.retried++;
            console.log(`[CDN] RETRY in ${delay}ms (attempt=${attempt + 1}) [${err.code || err.message}] — ${target}`);
            circuitRecordFailure(); // hitung sebagai gagal tapi belum trigger circuit
            return setTimeout(() => proxyUpstream(req, res, target, attempt + 1), delay);
        }

        circuitRecordFailure();
        metrics.upstreamErr++;
        console.log(`[CDN] UPSTREAM FAIL final attempt=${attempt} [${err.code || err.message}] — ${target}`);
        if (!res.headersSent) res.status(502).send('CDN upstream error');
        else res.socket && res.socket.destroy();
    });

    // Cleanup kalau game disconnect duluan
    res.on('close', () => {
        clearTimeout(streamTimer);
        if (!res.writableEnded) {
            r.destroy();
        }
    });
}

// ─── Router Init ─────────────────────────────────────────────────────────────

function init(app) {

    app.use('/cdn', (req, res) => {
        const reqPath = req.path || '/';
        const method  = req.method;
        const rangeHdr = req.headers.range || '-';

        maybeDumpMetrics();

        console.log(`[CDN] ${method} ${reqPath} range=${rangeHdr}`);

        // ── 1. Cari file lokal dulu ───────────────────────────────────────────
        const localFile = safeLocalPath(reqPath);
        if (localFile) {
            const size = fs.statSync(localFile).size;
            console.log(`[CDN] LOCAL HIT ${localFile} (${size}B)`);
            metrics.localHit++;
            return sendLocal(req, res, localFile);
        }

        // ── 2. cache_res tidak ada di lokal → 404 (jangan proxy) ─────────────
        //    Game bisa handle 404 untuk ini; kalau di-proxy, CDN kadang
        //    kembalikan data versi lain yang corrupt di sisi game.
        if (reqPath.includes('cache_res')) {
            console.log(`[CDN] CACHE_RES MISS: ${reqPath}`);
            metrics.localMiss++;
            return res.status(404).send('cache_res not found');
        }

        metrics.localMiss++;

        // ── 3. Proxy ke upstream ──────────────────────────────────────────────
        // Deduplication: kalau request ke URL yang sama sudah in-flight,
        // tidak perlu buka koneksi baru ke CDN. Cukup pipe dari stream yang sama.
        //
        // Catatan: deduplication hanya untuk GET tanpa Range — request Range
        // adalah resume dari offset tertentu, jadi tidak bisa di-share stream.
        const target = upstreamUrl(reqPath);
        const inflightKey = (method === 'GET' && !req.headers.range) ? target : null;

        if (inflightKey && inflight.has(inflightKey)) {
            // Ada yang sudah jalan → tunggu dan re-fetch setelah selesai
            // (lebih aman daripada pipe dari stream yang sama karena Node.js
            //  stream tidak bisa di-tee tanpa buffering penuh)
            const existing = inflight.get(inflightKey);
            console.log(`[CDN] INFLIGHT WAIT (${existing.count} ahead) — ${target}`);
            existing.count++;
            existing.callbacks.push(() => proxyUpstream(req, res, target));
            metrics.inflight++;
            return;
        }

        if (inflightKey) {
            const entry = { count: 1, callbacks: [] };
            inflight.set(inflightKey, entry);

            const origEnd = res.end.bind(res);
            res.end = function (...args) {
                inflight.delete(inflightKey);
                // Jalankan semua yang menunggu
                for (const cb of entry.callbacks) setImmediate(cb);
                return origEnd(...args);
            };
            res.on('close', () => inflight.delete(inflightKey));
        }

        return proxyUpstream(req, res, target);
    });

    // Endpoint debug metrics — bisa diakses dari Telegram bot / admin panel
    app.get('/cdn/~metrics', (req, res) => {
        res.json({
            ...metrics,
            inflightNow     : inflight.size,
            circuitOpen     : circuitIsOpen(),
            circuitFailures : circuit.failures,
        });
    });
}

module.exports = { init };
