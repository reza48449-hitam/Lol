// modules/cdn.js
// CDN handler — Railway fast pass-through
//
// Cara kerja:
//   1. Cek file lokal dulu (instant, langsung pipe)
//   2. Kalau tidak ada → fetch dari CDN Garena, pipe langsung ke game
//
// Optimasi utama untuk BigFile (MultiThreadDownloadHanlder):
//   - Agent keep-alive dengan maxSockets besar → koneksi sudah warm
//   - Zero buffering: upstreamRes.pipe(res) langsung tanpa collect dulu
//   - Range request di-forward 1-to-1, proxy tidak re-chunk
//   - Kalau mid-stream drop → socket.destroy() supaya game retry seketika
//   - Retry 3x dengan jeda singkat untuk ECONNRESET / timeout

'use strict';

const path  = require('path');
const fs    = require('fs');
const https = require('https');

// ── Konfigurasi ───────────────────────────────────────────────────────────────

const BASE_DIR    = path.resolve(__dirname, '..', 'public', 'cdn');
const CDN_VERSION = '1.130.22';
const CDN_HOST    = 'dl.cdn.freefiremobile.com';

// Game download paralel — maxSockets harus besar supaya tidak antri di agent
const AGENT = new https.Agent({
    keepAlive     : true,
    keepAliveMsecs: 20_000,
    maxSockets    : 64,   // cukup untuk semua thread BigFile + request kecil
    maxFreeSockets: 16,
    timeout       : 90_000,
});

const TIMEOUT_MS = 90_000;  // 90s per request — cukup untuk file 3-4 MB
const RETRY_MAX  = 3;

// Header CDN yang di-relay ke game (jangan tambah, nanti ada konflik)
const RELAY_HEADERS = [
    'content-type', 'content-length', 'content-range',
    'accept-ranges', 'etag', 'last-modified', 'cache-control',
];

// ── Local path resolution ─────────────────────────────────────────────────────

function resolveLocal(urlPath) {
    let p;
    try { p = decodeURIComponent(urlPath); }
    catch (_) { p = urlPath; }

    p = p.replace(/\\/g, '/');
    if (p.includes('\0') || p.includes('..')) return null;

    const try_ = (candidate) => {
        const abs = path.resolve(candidate);
        if (!abs.startsWith(BASE_DIR + path.sep) && abs !== BASE_DIR) return null;
        try { return fs.statSync(abs).isFile() ? abs : null; }
        catch (_) { return null; }
    };

    return (
        try_(path.join(BASE_DIR, p.replace(/^\/+/, ''))) ||
        try_(path.join(BASE_DIR, p.replace(/^\/live\/ABHotUpdates\/?/, ''))) ||
        // codepatch fallback: game minta versi-spesifik, file ada di live/ABHotUpdates/
        (() => {
            const m = /^\/live\/ABHotUpdates\/android_astc\/[^/]+\/(gameassetbundles\/codepatch\/[^/]+)$/.exec(p);
            return m ? try_(path.join(BASE_DIR, 'live', 'ABHotUpdates', m[1])) : null;
        })()
    );
}

// ── Local file serve (dengan Range support) ───────────────────────────────────

function serveLocal(req, res, filePath) {
    const size = (() => { try { return fs.statSync(filePath).size; } catch (_) { return -1; } })();
    if (size < 0) return res.status(500).end();

    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type',  'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=3600');

    if (req.method === 'HEAD') {
        res.setHeader('Content-Length', String(size));
        return res.status(200).end();
    }

    const rangeHdr = req.headers.range;

    // ── Full file ─────────────────────────────────────────────────────────────
    if (!rangeHdr) {
        res.setHeader('Content-Length', String(size));
        const s = fs.createReadStream(filePath);
        res.on('close', () => s.destroy());
        s.on('error', err => {
            console.log(`[CDN] LOCAL ERR: ${err.message}`);
            if (!res.headersSent) res.status(500).end();
            else res.socket?.destroy();
        });
        return s.pipe(res);
    }

    // ── Range request ─────────────────────────────────────────────────────────
    const m = /^bytes=(\d*)-(\d*)$/.exec(rangeHdr);
    if (!m) return res.status(416).setHeader('Content-Range', `bytes */${size}`).end();

    let start, end;
    if (!m[1] && m[2]) {
        // suffix: bytes=-N
        start = Math.max(0, size - Number(m[2]));
        end   = size - 1;
    } else {
        start = m[1] ? Number(m[1]) : 0;
        end   = m[2] ? Number(m[2]) : size - 1;
    }

    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= size) {
        return res.status(416).setHeader('Content-Range', `bytes */${size}`).end();
    }
    end = Math.min(end, size - 1);

    res.status(206);
    res.setHeader('Content-Range',  `bytes ${start}-${end}/${size}`);
    res.setHeader('Content-Length', String(end - start + 1));

    const s = fs.createReadStream(filePath, { start, end });
    res.on('close', () => s.destroy());
    s.on('error', err => {
        console.log(`[CDN] LOCAL RANGE ERR: ${err.message}`);
        if (!res.headersSent) res.status(500).end();
        else res.socket?.destroy();
    });
    return s.pipe(res);
}

// ── Upstream URL builder ──────────────────────────────────────────────────────

function toUpstreamUrl(reqPath) {
    let p = reqPath.startsWith('/') ? reqPath : '/' + reqPath;
    if (!p.includes('/live/ABHotUpdates/')) p = '/live/ABHotUpdates' + p;
    p = p.replace(/\/OB\d+\//g,    `/${CDN_VERSION}/`);
    p = p.replace(/\/1\.126\.3\//g, `/${CDN_VERSION}/`);
    return `https://${CDN_HOST}${p}`;
}

// ── Upstream fetch → stream ke game ──────────────────────────────────────────
//
// Prinsip kecepatan:
//   - TIDAK ada collect/buffer — upstreamRes langsung pipe ke res
//   - Range header dari game di-forward 1-to-1 ke CDN
//   - Kalau koneksi CDN putus setelah pipe mulai → socket.destroy() ke game
//     supaya game tau koneksi drop dan retry seketika (tidak nunggu timeout)

function fetchUpstream(req, res, url, attempt) {
    attempt = attempt || 1;
    console.log(`[CDN] UPSTREAM${attempt > 1 ? ' retry=' + attempt : ''} ${url} range=${req.headers.range || '-'}`);

    let u;
    try { u = new URL(url); }
    catch (_) { if (!res.headersSent) res.status(400).end(); return; }

    const headers = {
        'Host'           : u.host,
        'User-Agent'     : req.headers['user-agent']      || 'Dalvik/2.1.0',
        'Accept'         : req.headers['accept']          || '*/*',
        'Accept-Language': req.headers['accept-language'] || 'id-ID,en-US;q=0.9',
        'Connection'     : 'keep-alive',
    };
    if (req.headers.range) headers['Range'] = req.headers.range;

    const r = https.get({
        hostname: u.hostname,
        path    : u.pathname + (u.search || ''),
        headers,
        agent   : AGENT,
    }, upRes => {
        const status = upRes.statusCode || 502;

        if (!res.headersSent) {
            res.statusCode = status;
            for (const h of RELAY_HEADERS) {
                if (upRes.headers[h] != null) res.setHeader(h, upRes.headers[h]);
            }
        }

        // Zero-copy stream — data langsung mengalir ke game tanpa buffer
        upRes.pipe(res, { end: true });

        // Kalau upstream drop setelah pipe mulai → paksa tutup ke game
        // supaya game detect putus dan retry (bukan nunggu timeout 30-60s)
        upRes.on('error', err => {
            console.log(`[CDN] UPSTREAM PIPE ERR: ${err.message}`);
            if (!res.headersSent) res.status(502).end();
            else res.socket?.destroy();
        });

        // Cleanup bila game disconnect duluan
        res.on('close', () => { if (!upRes.destroyed) upRes.destroy(); });
    });

    // Timeout seluruh request (connect + stream)
    r.setTimeout(TIMEOUT_MS, () => {
        r.destroy(new Error('timeout'));
    });

    r.on('error', err => {
        const retryable =
            err.code === 'ECONNRESET' ||
            err.code === 'ETIMEDOUT'  ||
            err.code === 'EPIPE'      ||
            err.message === 'timeout';

        if (retryable && attempt < RETRY_MAX) {
            // Jeda singkat biar koneksi Railway settle, lalu coba lagi
            const delay = 300 * attempt;
            console.log(`[CDN] RETRY in ${delay}ms [${err.code || err.message}] — ${url}`);
            return setTimeout(() => fetchUpstream(req, res, url, attempt + 1), delay);
        }

        console.log(`[CDN] FAIL [${err.code || err.message}] attempt=${attempt} — ${url}`);
        if (!res.headersSent) res.status(502).send('upstream error');
        else res.socket?.destroy();
    });

    // Cleanup bila game disconnect sebelum upstream response datang
    res.on('close', () => { if (!r.destroyed) r.destroy(); });
}

// ── Init ──────────────────────────────────────────────────────────────────────

function init(app) {
    app.use('/cdn', (req, res) => {
        const p = req.path || '/';

        console.log(`[CDN] ${req.method} ${p} range=${req.headers.range || '-'}`);

        // 1. File lokal → langsung serve (paling cepat, tidak perlu network)
        const local = resolveLocal(p);
        if (local) {
            console.log(`[CDN] LOCAL ${local}`);
            return serveLocal(req, res, local);
        }

        // 2. cache_res tidak ada di lokal → 404
        //    Jangan proxy: CDN kadang balikin versi lain → corrupt di game
        if (p.includes('cache_res')) {
            return res.status(404).end();
        }

        // 3. Fetch dari CDN Garena langsung
        return fetchUpstream(req, res, toUpstreamUrl(p));
    });
}

module.exports = { init };
