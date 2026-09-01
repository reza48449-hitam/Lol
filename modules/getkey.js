'use strict';

/*
 * modules/getkey.js
 *
 * GET  /getkey
 * POST /getkey/gen
 * GET  /getkey/verify?token=TOKEN
 * GET  /verifikasi.php?token=TOKEN
 * GET  /getkey/status
 * POST /getkey/check
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');

// ============================================================
// CONFIG
// ============================================================

// Masukkan API TOKEN Move2link baru lo di sini.
// JANGAN masukkan token ini ke frontend.
const MOVE2LINK_API_KEY =
    'GANTI_DENGAN_API_TOKEN_MOVE2LINK_BARU';

const KEY_DURATION      = 24 * 60 * 60 * 1000; // 24 jam
const COOLDOWN_DURATION = 24 * 60 * 60 * 1000; // 24 jam
const TOKEN_EXPIRATION  = 30 * 60 * 1000;      // 30 menit

const RATE_LIMIT_GEN    = 5;
const RATE_LIMIT_WINDOW = 60 * 60 * 1000;

const DB_PATH = path.join(
    __dirname,
    '..',
    'db',
    'getkey.json'
);


// ============================================================
// DATABASE
// ============================================================

function dbLoad() {
    try {
        if (!fs.existsSync(DB_PATH)) {
            return {
                keys: {},
                tokens: {},
                cooldowns: {},
                ratelimit: {}
            };
        }

        const raw = fs.readFileSync(DB_PATH, 'utf8');

        if (!raw.trim()) {
            return {
                keys: {},
                tokens: {},
                cooldowns: {},
                ratelimit: {}
            };
        }

        const data = JSON.parse(raw);

        return {
            keys: data.keys || {},
            tokens: data.tokens || {},
            cooldowns: data.cooldowns || {},
            ratelimit: data.ratelimit || {}
        };

    } catch (err) {
        console.log('[GETKEY] DB LOAD ERROR:', err.message);

        return {
            keys: {},
            tokens: {},
            cooldowns: {},
            ratelimit: {}
        };
    }
}


function dbSave(db) {
    try {
        const dir = path.dirname(DB_PATH);

        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, {
                recursive: true
            });
        }

        const temp = DB_PATH + '.tmp';

        fs.writeFileSync(
            temp,
            JSON.stringify(db, null, 2),
            'utf8'
        );

        fs.renameSync(temp, DB_PATH);

    } catch (err) {
        console.log('[GETKEY] DB SAVE ERROR:', err.message);
    }
}


// ============================================================
// CLEANUP
// ============================================================

function cleanupDb(db) {
    const now = Date.now();

    // Token expired
    for (const [hash, token] of Object.entries(db.tokens)) {
        if (
            token.expired_at &&
            token.expired_at <= now
        ) {
            delete db.tokens[hash];
        }
    }

    // Cooldown expired
    for (const [ip, cooldown] of Object.entries(db.cooldowns)) {
        if (
            cooldown.expires_at &&
            cooldown.expires_at <= now
        ) {
            delete db.cooldowns[ip];
        }
    }

    // Rate limit cleanup
    for (const [key, item] of Object.entries(db.ratelimit)) {

        if (!Array.isArray(item.hits)) {
            delete db.ratelimit[key];
            continue;
        }

        item.hits = item.hits.filter(
            timestamp =>
                timestamp > now - RATE_LIMIT_WINDOW
        );

        if (item.hits.length === 0) {
            delete db.ratelimit[key];
        }
    }
}


// ============================================================
// HELPERS
// ============================================================

function getIp(req) {
    let ip =
        req.headers['x-forwarded-for'] ||
        req.socket?.remoteAddress ||
        '';

    ip = String(ip)
        .split(',')[0]
        .trim();

    if (ip.startsWith('::ffff:')) {
        ip = ip.substring(7);
    }

    return ip || 'unknown';
}


function getUserAgent(req) {
    return String(
        req.headers['user-agent'] || ''
    ).substring(0, 500);
}


function detectDevice(userAgent) {

    const ua = String(userAgent).toLowerCase();

    if (ua.includes('android')) {
        return 'Android';
    }

    if (ua.includes('iphone')) {
        return 'iPhone';
    }

    if (ua.includes('ipad')) {
        return 'iPad';
    }

    if (ua.includes('windows')) {
        return 'Windows';
    }

    if (ua.includes('macintosh') ||
        ua.includes('mac os')) {
        return 'Mac';
    }

    if (ua.includes('linux')) {
        return 'Linux';
    }

    return 'Unknown';
}


function generateKey() {

    const chars =
        'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

    const parts = [];

    for (let p = 0; p < 4; p++) {

        let part = '';

        for (let i = 0; i < 4; i++) {

            const index =
                crypto.randomInt(0, chars.length);

            part += chars[index];
        }

        parts.push(part);
    }

    return parts.join('-');
}


function generateToken() {

    return crypto
        .randomBytes(32)
        .toString('hex');
}


function hashToken(token) {

    return crypto
        .createHash('sha256')
        .update(token)
        .digest('hex');
}


function checkRateLimit(
    db,
    ip,
    action,
    max
) {

    const now = Date.now();
    const key = `${action}:${ip}`;

    if (!db.ratelimit[key]) {
        db.ratelimit[key] = {
            hits: []
        };
    }

    db.ratelimit[key].hits =
        db.ratelimit[key].hits.filter(
            timestamp =>
                timestamp >
                now - RATE_LIMIT_WINDOW
        );

    if (
        db.ratelimit[key].hits.length >= max
    ) {
        return false;
    }

    db.ratelimit[key].hits.push(now);

    return true;
}


function getBaseUrl(req) {

    const forwardedProto =
        req.headers['x-forwarded-proto'];

    const protocol =
        forwardedProto ||
        req.protocol ||
        'http';

    const host =
        req.headers.host ||
        'localhost';

    return `${protocol}://${host}`;
}


// ============================================================
// MOVE2LINK API
// ============================================================

function callMove2link(destinationUrl) {

    return new Promise((resolve) => {

        if (
            !MOVE2LINK_API_KEY ||
            MOVE2LINK_API_KEY ===
            'GANTI_DENGAN_API_TOKEN_MOVE2LINK_BARU'
        ) {
            return resolve({
                success: false,
                error: 'Move2link API token belum diisi.'
            });
        }

        const payload = JSON.stringify({
            url: destinationUrl
        });

        const options = {
            hostname: 'api.move2link.com',
            port: 443,
            path: '/api/v1/links',
            method: 'POST',

            headers: {
                'Authorization':
                    `Bearer ${MOVE2LINK_API_KEY}`,

                'Content-Type':
                    'application/json',

                'Content-Length':
                    Buffer.byteLength(payload),

                'Accept':
                    'application/json',

                'User-Agent':
                    'KeySystem/1.0'
            },

            timeout: 15000
        };

        const request =
            https.request(
                options,
                (response) => {

                    let body = '';

                    response.setEncoding('utf8');

                    response.on(
                        'data',
                        chunk => {
                            body += chunk;
                        }
                    );

                    response.on(
                        'end',
                        () => {

                            let data = null;

                            try {
                                data =
                                    JSON.parse(body);
                            } catch (_) {
                                data = null;
                            }

                            // ==================================
                            // SUCCESS
                            // ==================================

                            if (
                                response.statusCode === 201
                            ) {

                                const shortLink =
                                    data?.data?.short_link;

                                if (!shortLink) {

                                    return resolve({
                                        success: false,
                                        error:
                                            'Move2link tidak mengembalikan data.short_link.',
                                        statusCode:
                                            response.statusCode
                                    });
                                }

                                return resolve({
                                    success: true,
                                    url: shortLink,
                                    response: data
                                });
                            }

                            // ==================================
                            // ERRORS
                            // ==================================

                            let message =
                                `Move2link HTTP ${response.statusCode}`;

                            if (
                                response.statusCode === 400
                            ) {
                                message =
                                    'Request Move2link tidak valid.';
                            }

                            else if (
                                response.statusCode === 401
                            ) {
                                message =
                                    'API token Move2link tidak valid.';
                            }

                            else if (
                                response.statusCode === 403
                            ) {
                                message =
                                    'REST API Move2link dinonaktifkan. Aktifkan "Shortlink without login" di Settings.';
                            }

                            else if (
                                response.statusCode === 429
                            ) {
                                message =
                                    'Rate limit Move2link tercapai. Coba lagi nanti.';
                            }

                            // Ambil message API jika ada
                            if (
                                data?.status?.message
                            ) {
                                message +=
                                    ` ${data.status.message}`;
                            }

                            return resolve({
                                success: false,
                                error: message,
                                statusCode:
                                    response.statusCode,
                                response: data
                            });
                        }
                    );
                }
            );

        request.on(
            'timeout',
            () => {
                request.destroy();

                resolve({
                    success: false,
                    error:
                        'Request Move2link timeout.'
                });
            }
        );

        request.on(
            'error',
            (error) => {

                resolve({
                    success: false,
                    error:
                        `Move2link connection error: ${error.message}`
                });
            }
        );

        request.write(payload);
        request.end();
    });
}


// ============================================================
// VERIFY SUCCESS PAGE
// ============================================================

function sendVerifySuccess(
    res,
    key,
    expiredAt,
    device
) {

    const exp =
        new Date(expiredAt)
            .toLocaleString('id-ID');

    const safeKey =
        String(key)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');

    res.status(200).send(`<!DOCTYPE html>

<html lang="id">

<head>

<meta charset="UTF-8">

<meta
    name="viewport"
    content="width=device-width,initial-scale=1"
/>

<title>Key Berhasil</title>

<style>

* {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
}

body {
    min-height: 100vh;
    background: #05080f;
    color: #e6edf3;
    font-family:
        Arial,
        Helvetica,
        sans-serif;

    display: flex;
    align-items: center;
    justify-content: center;

    padding: 20px;
}

.card {
    width: 100%;
    max-width: 430px;

    background: #0d1117;

    border:
        1px solid #21262d;

    border-radius: 18px;

    padding: 30px;

    text-align: center;

    box-shadow:
        0 20px 50px
        rgba(0,0,0,.35);
}

.icon {
    font-size: 52px;
    margin-bottom: 15px;
}

.title {
    font-size: 22px;
    font-weight: 700;
    color: #3fb950;
    margin-bottom: 8px;
}

.sub {
    color: #8b949e;
    font-size: 14px;
    margin-bottom: 22px;
}

.key {
    background: #161b22;

    border:
        1px solid #30363d;

    border-radius: 12px;

    padding: 18px 10px;

    font-family:
        monospace;

    font-size: 20px;

    font-weight: bold;

    color: #58a6ff;

    letter-spacing: 2px;

    cursor: pointer;

    word-break: break-all;
}

.info {
    margin-top: 12px;

    color: #8b949e;

    font-size: 13px;
}

.btn {
    display: inline-block;

    margin-top: 22px;

    padding:
        12px 20px;

    border-radius: 9px;

    background: #238636;

    color: white;

    text-decoration: none;

    font-weight: 600;
}

</style>

</head>

<body>

<div class="card">

    <div class="icon">🎉</div>

    <div class="title">
        Key Berhasil Dibuat
    </div>

    <div class="sub">
        Klik key untuk menyalin
    </div>

    <div
        class="key"
        onclick="copyKey()"
        id="key"
    >
        ${safeKey}
    </div>

    <div class="info">
        ⏰ Berlaku sampai: ${exp}
    </div>

    <div class="info">
        📱 Device: ${device}
    </div>

    <a
        href="/getkey"
        class="btn"
    >
        Kembali
    </a>

</div>

<script>

function copyKey() {

    const key =
        document.getElementById('key')
            .innerText;

    if (
        navigator.clipboard
    ) {

        navigator.clipboard
            .writeText(key)
            .then(() => {
                alert('Key berhasil dicopy!');
            });

    } else {

        alert(key);
    }
}

</script>

</body>

</html>`);
}


function sendVerifyError(
    res,
    message
) {

    const safeMessage =
        String(message)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');

    res.status(400).send(`<!DOCTYPE html>

<html lang="id">

<head>

<meta charset="UTF-8">

<meta
    name="viewport"
    content="width=device-width,initial-scale=1"
/>

<title>Verifikasi Gagal</title>

<style>

* {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
}

body {
    min-height: 100vh;

    background: #05080f;

    color: white;

    font-family: Arial;

    display: flex;

    align-items: center;
    justify-content: center;

    padding: 20px;
}

.card {
    max-width: 430px;
    width: 100%;

    background: #0d1117;

    border:
        1px solid #21262d;

    border-radius: 18px;

    padding: 30px;

    text-align: center;
}

.icon {
    font-size: 50px;
    margin-bottom: 15px;
}

.title {
    color: #f85149;

    font-size: 21px;

    font-weight: bold;

    margin-bottom: 10px;
}

.message {
    color: #8b949e;

    font-size: 14px;

    line-height: 1.5;
}

.btn {
    display: inline-block;

    margin-top: 20px;

    padding:
        12px 20px;

    background: #238636;

    color: white;

    text-decoration: none;

    border-radius: 9px;
}

</style>

</head>

<body>

<div class="card">

    <div class="icon">❌</div>

    <div class="title">
        Verifikasi Gagal
    </div>

    <div class="message">
        ${safeMessage}
    </div>

    <a
        href="/getkey"
        class="btn"
    >
        Kembali
    </a>

</div>

</body>

</html>`);
}


// ============================================================
// INIT ROUTES
// ============================================================

function init(app) {

    // ========================================================
    // GETKEY PAGE
    // ========================================================

    app.get(
        '/getkey',
        (req, res) => {

            res.sendFile(
                path.join(
                    __dirname,
                    '..',
                    'public',
                    'getkey.html'
                )
            );
        }
    );


    // ========================================================
    // GENERATE SHORTLINK
    // ========================================================

    app.post(
        '/getkey/gen',
        async (req, res) => {

            try {

                const ip =
                    getIp(req);

                const ua =
                    getUserAgent(req);

                const db =
                    dbLoad();

                cleanupDb(db);

                // --------------------------------------------
                // RATE LIMIT
                // --------------------------------------------

                if (
                    !checkRateLimit(
                        db,
                        ip,
                        'generate',
                        RATE_LIMIT_GEN
                    )
                ) {

                    dbSave(db);

                    return res.status(429).json({
                        success: false,
                        message:
                            'Terlalu banyak request. Coba lagi nanti.'
                    });
                }


                // --------------------------------------------
                // EXISTING COOLDOWN
                // --------------------------------------------

                const cooldown =
                    db.cooldowns[ip];

                const now =
                    Date.now();

                if (
                    cooldown &&
                    cooldown.expires_at > now
                ) {

                    dbSave(db);

                    return res.json({

                        success: false,

                        cooldown: true,

                        message:
                            'Kamu masih dalam cooldown.',

                        next_at:
                            cooldown.expires_at,

                        remaining:
                            Math.ceil(
                                (
                                    cooldown.expires_at -
                                    now
                                ) / 1000
                            )
                    });
                }


                // --------------------------------------------
                // GENERATE TOKEN
                // --------------------------------------------

                const rawToken =
                    generateToken();

                const tokenHash =
                    hashToken(rawToken);

                const tokenExpired =
                    now +
                    TOKEN_EXPIRATION;


                // --------------------------------------------
                // BASE URL
                // --------------------------------------------

                const baseUrl =
                    getBaseUrl(req);


                // --------------------------------------------
                // VERIFICATION URL
                // --------------------------------------------

                const verifyUrl =
                    `${baseUrl}/verifikasi.php?token=${encodeURIComponent(rawToken)}`;


                // --------------------------------------------
                // SAVE TOKEN FIRST
                // --------------------------------------------

                db.tokens[tokenHash] = {

                    token_hash:
                        tokenHash,

                    created_at:
                        now,

                    expired_at:
                        tokenExpired,

                    ip:
                        ip,

                    ua:
                        ua,

                    status:
                        'pending'
                };

                dbSave(db);


                // --------------------------------------------
                // MOVE2LINK
                // --------------------------------------------

                console.log(
                    `[GETKEY] Creating Move2link link for ${ip}`
                );

                const result =
                    await callMove2link(
                        verifyUrl
                    );


                // --------------------------------------------
                // MOVE2LINK FAILED
                // --------------------------------------------

                if (
                    !result.success
                ) {

                    const failedDb =
                        dbLoad();

                    delete failedDb.tokens[
                        tokenHash
                    ];

                    dbSave(failedDb);

                    console.log(
                        '[GETKEY] Move2link error:',
                        result.error
                    );

                    return res.status(502).json({

                        success: false,

                        message:
                            'Gagal membuat shortlink Move2link.',

                        error:
                            result.error
                    });
                }


                // --------------------------------------------
                // SUCCESS
                // --------------------------------------------

                console.log(
                    '[GETKEY] Move2link:',
                    result.url
                );

                return res.json({

                    success: true,

                    redirect_url:
                        result.url,

                    expires_in:
                        Math.floor(
                            TOKEN_EXPIRATION / 1000
                        )
                });

            } catch (error) {

                console.log(
                    '[GETKEY] GEN ERROR:',
                    error
                );

                return res.status(500).json({

                    success: false,

                    message:
                        'Internal server error.'
                });
            }
        }
    );


    // ========================================================
    // VERIFY
    // /getkey/verify
    // /verifikasi.php
    // ========================================================

    async function verifyHandler(
        req,
        res
    ) {

        try {

            const token =
                String(
                    req.query.token || ''
                ).trim();

            const ip =
                getIp(req);

            const ua =
                getUserAgent(req);

            const device =
                detectDevice(ua);

            const now =
                Date.now();


            if (
                !token ||
                token.length !== 64
            ) {

                return sendVerifyError(
                    res,
                    '❌ Token tidak valid.'
                );
            }


            const tokenHash =
                hashToken(token);

            const db =
                dbLoad();

            cleanupDb(db);


            const tokenRow =
                db.tokens[tokenHash];


            if (!tokenRow) {

                dbSave(db);

                return sendVerifyError(
                    res,
                    '❌ Token tidak ditemukan atau sudah expired.'
                );
            }


            if (
                tokenRow.status === 'used'
            ) {

                return sendVerifyError(
                    res,
                    '❌ Token sudah digunakan.'
                );
            }


            if (
                tokenRow.expired_at <= now
            ) {

                tokenRow.status =
                    'expired';

                dbSave(db);

                return sendVerifyError(
                    res,
                    '❌ Token sudah expired. Silakan generate ulang.'
                );
            }


            // --------------------------------------------
            // IP BINDING
            // --------------------------------------------

            if (
                tokenRow.ip !== ip
            ) {

                console.log(
                    `[GETKEY] IP mismatch ${tokenRow.ip} -> ${ip}`
                );

                return sendVerifyError(
                    res,
                    '❌ Token harus digunakan dari perangkat/IP yang sama.'
                );
            }


            // --------------------------------------------
            // CHECK EXISTING ACTIVE KEY
            // --------------------------------------------

            const activeKey =
                Object.values(db.keys)
                    .find(key =>
                        key.ip === ip &&
                        key.status === 'active' &&
                        key.expired_at > now
                    );

            if (activeKey) {

                return sendVerifyError(
                    res,
                    '⚠ Kamu masih memiliki key aktif.'
                );
            }


            // --------------------------------------------
            // GENERATE UNIQUE KEY
            // --------------------------------------------

            let newKey = null;

            for (
                let i = 0;
                i < 20;
                i++
            ) {

                const candidate =
                    generateKey();

                if (
                    !db.keys[candidate]
                ) {

                    newKey =
                        candidate;

                    break;
                }
            }


            if (!newKey) {

                return sendVerifyError(
                    res,
                    '❌ Gagal membuat key. Coba lagi.'
                );
            }


            const keyExpired =
                now +
                KEY_DURATION;


            // --------------------------------------------
            // SAVE KEY
            // --------------------------------------------

            db.keys[newKey] = {

                key:
                    newKey,

                status:
                    'active',

                created_at:
                    now,

                expired_at:
                    keyExpired,

                ip:
                    ip,

                ua:
                    ua,

                device:
                    device,

                last_used:
                    now,

                usage_count:
                    0
            };


            // --------------------------------------------
            // TOKEN USED
            // --------------------------------------------

            tokenRow.status =
                'used';

            tokenRow.used_at =
                now;


            // --------------------------------------------
            // COOLDOWN
            // --------------------------------------------

            db.cooldowns[ip] = {

                expires_at:
                    now +
                    COOLDOWN_DURATION
            };


            dbSave(db);


            console.log(
                `[GETKEY] Key generated: ${newKey} | ${ip} | ${device}`
            );


            return sendVerifySuccess(
                res,
                newKey,
                keyExpired,
                device
            );

        } catch (error) {

            console.log(
                '[GETKEY] VERIFY ERROR:',
                error
            );

            return sendVerifyError(
                res,
                '❌ Terjadi kesalahan pada server.'
            );
        }
    }


    app.get(
        '/getkey/verify',
        verifyHandler
    );

    // Alias sesuai format yang lo minta
    app.get(
        '/verifikasi.php',
        verifyHandler
    );


    // ========================================================
    // STATUS
    // ========================================================

    app.get(
        '/getkey/status',
        (req, res) => {

            const ip =
                getIp(req);

            const db =
                dbLoad();

            const now =
                Date.now();

            cleanupDb(db);

            const key =
                Object.values(db.keys)
                    .find(item =>
                        item.ip === ip &&
                        item.status === 'active' &&
                        item.expired_at > now
                    );


            if (!key) {

                const cooldown =
                    db.cooldowns[ip];

                return res.json({

                    status:
                        'NONE',

                    cooldown:
                        cooldown &&
                        cooldown.expires_at > now
                            ? {
                                active: true,
                                expires_at:
                                    cooldown.expires_at,
                                remaining:
                                    Math.ceil(
                                        (
                                            cooldown.expires_at -
                                            now
                                        ) / 1000
                                    )
                            }
                            : {
                                active: false
                            }
                });
            }


            return res.json({

                status:
                    'ACTIVE',

                key:
                    key.key,

                expires_at:
                    key.expired_at,

                remaining:
                    Math.ceil(
                        (
                            key.expired_at -
                            now
                        ) / 1000
                    ),

                device:
                    key.device
            });
        }
    );


    // ========================================================
    // CHECK KEY
    // ========================================================

    app.post(
        '/getkey/check',
        (req, res) => {

            let body =
                req.body || {};

            if (
                Buffer.isBuffer(body)
            ) {

                try {

                    body =
                        JSON.parse(
                            body.toString()
                        );

                } catch (_) {

                    body = {};
                }
            }


            const inputKey =
                String(
                    body.key ||
                    req.query.key ||
                    ''
                )
                    .toUpperCase()
                    .trim();


            if (!inputKey) {

                return res.json({

                    valid: false,

                    reason:
                        'Key kosong'
                });
            }


            const db =
                dbLoad();

            const now =
                Date.now();

            const key =
                db.keys[inputKey];


            if (!key) {

                return res.json({

                    valid: false,

                    reason:
                        'Key tidak ditemukan'
                });
            }


            if (
                key.status === 'revoked'
            ) {

                return res.json({

                    valid: false,

                    reason:
                        'Key sudah direvoke'
                });
            }


            if (
                key.expired_at <= now
            ) {

                key.status =
                    'expired';

                dbSave(db);

                return res.json({

                    valid: false,

                    reason:
                        'Key sudah expired'
                });
            }


            if (
                key.status !== 'active'
            ) {

                return res.json({

                    valid: false,

                    reason:
                        `Status: ${key.status}`
                });
            }


            return res.json({

                valid: true,

                status:
                    'ACTIVE',

                expires_at:
                    key.expired_at,

                remaining:
                    Math.ceil(
                        (
                            key.expired_at -
                            now
                        ) / 1000
                    ),

                device:
                    key.device
            });
        }
    );
}


module.exports = {
    init
};
