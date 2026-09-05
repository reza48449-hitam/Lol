// modules/cdn.js
// Railway-safe CDN handler:
// - Explicit local-file resolution for /cdn/live/ABHotUpdates/*
// - Supports Range/HEAD so game downloaders can resume correctly
// - Never returns a JSON success body for a missing binary asset
// - Falls back to upstream only for non-local assets

'use strict';

const path = require('path');
const fs = require('fs');
const https = require('https');

const BASE_DIR = path.resolve(__dirname, '..', 'public', 'cdn');
const VERSION = '1.130.22';

function safeLocalPath(urlPath) {
    let p;
    try {
        // Express req.path is normally decoded; decode once for clients that percent-encode.
        p = decodeURIComponent(urlPath);
    } catch (_) {
        p = urlPath;
    }

    // Prevent traversal.
    p = p.replace(/\\/g, '/');
    if (p.includes('\0') || p.includes('..')) return null;

    const candidates = [
        path.join(BASE_DIR, p.replace(/^\/+/, '')),
        path.join(BASE_DIR, p.replace(/^\/live\/ABHotUpdates\/?/, '')),
    ];

    // Some OB54 fileinfo entries request android_astc/<version>/gameassetbundles/codepatch,
    // while this archive stores that codepatch under live/ABHotUpdates/gameassetbundles/codepatch.
    // Only apply this exact codepatch fallback; do not remap other Android ASTC assets.
    const codepatchMatch = /^\/live\/ABHotUpdates\/android_astc\/[^/]+\/(gameassetbundles\/codepatch\/[^/]+)$/.exec(p);
    if (codepatchMatch) {
        candidates.push(path.join(BASE_DIR, 'live', 'ABHotUpdates', codepatchMatch[1]));
        // Cek semua versi folder android_astc yang tersedia
        const astcDir = path.join(BASE_DIR, 'android_astc');
        if (fs.existsSync(astcDir)) {
            const vers = fs.readdirSync(astcDir);
            for (const v of vers) {
                candidates.push(path.join(BASE_DIR, 'android_astc', v, codepatchMatch[1]));
            }
        }
    }

    // Fallback: assembly-csharp-patch.bytes dari root project
    if (p.toLowerCase().includes('assembly-csharp-patch.bytes')) {
        const rootPatch = path.resolve(__dirname, '..', 'Assembly-CSharp-patch.bytes');
        if (fs.existsSync(rootPatch)) return rootPatch;
    }

    // Fallback: version mismatch — remap versi yang diminta ke versi yang tersedia
    const versionRemapMatch = /^\/android_astc\/([^/]+)\/(.+)$/.exec(p);
    if (versionRemapMatch && versionRemapMatch[1] !== VERSION) {
        candidates.push(path.join(BASE_DIR, 'android_astc', VERSION, versionRemapMatch[2]));
    }

    for (const candidate of candidates) {
        const resolved = path.resolve(candidate);
        if (resolved === BASE_DIR || resolved.startsWith(BASE_DIR + path.sep)) {
            if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
                return resolved;
            }
        }
    }
    return null;
}

function sendLocal(req, res, filePath) {
    const stat = fs.statSync(filePath);
    const size = stat.size;

    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Length', String(size));
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=3600');

    if (req.method === 'HEAD') return res.status(200).end();

    const range = req.headers.range;
    if (!range) {
        return fs.createReadStream(filePath)
            .on('error', err => {
                console.log(`[CDN] LOCAL STREAM ERROR: ${err.message}`);
                if (!res.headersSent) res.status(500).end();
            })
            .pipe(res);
    }

    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!m) return res.status(416).setHeader('Content-Range', `bytes */${size}`).end();

    let start = m[1] ? Number(m[1]) : 0;
    let end = m[2] ? Number(m[2]) : size - 1;

    if (!m[1] && m[2]) {
        const suffix = Number(m[2]);
        start = Math.max(0, size - suffix);
        end = size - 1;
    }

    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || start >= size) {
        return res.status(416).setHeader('Content-Range', `bytes */${size}`).end();
    }

    end = Math.min(end, size - 1);
    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
    res.setHeader('Content-Length', String(end - start + 1));

    return fs.createReadStream(filePath, { start, end })
        .on('error', err => {
            console.log(`[CDN] RANGE STREAM ERROR: ${err.message}`);
            if (!res.headersSent) res.status(500).end();
        })
        .pipe(res);
}

function upstreamTarget(reqPath) {
    let p = reqPath;
    if (!p.startsWith('/')) p = '/' + p;
    if (!p.includes('/live/ABHotUpdates/')) {
        p = `/live/ABHotUpdates${p}`;
    }
    p = p.replace('/OB54/', `/${VERSION}/`);
    p = p.replace('/1.126.3/', `/${VERSION}/`);
    return `https://dl.cdn.freefiremobile.com${p}`;
}

function proxyUpstream(req, res, target) {
    console.log(`[CDN] UPSTREAM ${target}`);

    const u = new URL(target);
    const headers = {
        'User-Agent': req.headers['user-agent'] || 'Dalvik/2.1.0',
        'Accept': req.headers.accept || '*/*',
        'Accept-Language': req.headers['accept-language'] || 'id-ID,en-US;q=0.9',
        'Connection': 'keep-alive',
        'Host': u.host
    };

    if (req.headers.range) headers.Range = req.headers.range;

    const r = https.get({ hostname: u.hostname, path: u.pathname + u.search, headers }, upstreamRes => {
        res.statusCode = upstreamRes.statusCode || 502;

        for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified', 'cache-control']) {
            if (upstreamRes.headers[h] !== undefined) res.setHeader(h, upstreamRes.headers[h]);
        }

        upstreamRes.pipe(res);
    });

    r.setTimeout(15000, () => r.destroy(new Error('upstream timeout')));
    r.on('error', err => {
        console.log(`[CDN] UPSTREAM ERROR: ${err.message}`);
        if (!res.headersSent) res.status(502).send('CDN upstream error');
    });
}

function init(app) {
    app.use('/cdn', (req, res) => {
        const reqPath = req.path || '/';
        console.log(`[CDN] ${req.method} ${reqPath} range=${req.headers.range || '-'}`);

        const local = safeLocalPath(reqPath);
        if (local) {
            const size = fs.statSync(local).size;
            console.log(`[CDN] LOCAL HIT ${local} (${size} bytes)`);
            return sendLocal(req, res, local);
        }

        // Do not fabricate a successful binary response for missing cache_res.
        if (reqPath.includes('cache_res')) {
            console.log(`[CDN] CACHE_RES MISS: ${reqPath}`);
            return res.status(404).send('cache_res not found');
        }

        return proxyUpstream(req, res, upstreamTarget(reqPath));
    });
}

module.exports = { init };
