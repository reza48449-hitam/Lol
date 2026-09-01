'use strict';
const express      = require('express');
const path         = require('path');
const fs           = require('fs');
const cookieParser = require('cookie-parser');
const https        = require('https');

const app  = express();
const PORT = process.env.PORT || 3030;

// ============ MODULES LOADER ============
function loadModules() {
    const modulesPath = path.join(__dirname, 'modules');
    if (!fs.existsSync(modulesPath)) return {};
    const loaded = {};
    const files = fs.readdirSync(modulesPath).filter(f => f.endsWith('.js'));
    for (const file of files) {
        // Skip getkey & telegram — dihapus sesuai permintaan
        if (file === 'getkey.js' || file === 'telegram.js') continue;
        try {
            const mod  = require(path.join(modulesPath, file));
            const name = path.basename(file, '.js');
            loaded[name] = mod;
        } catch (err) {
            console.log(`[MODULES] ERROR load ${file}: ${err.message}`);
        }
    }
    return loaded;
}

const modules = loadModules();

// ============ MIDDLEWARE ============
app.use(express.raw({ type: '*/*', limit: '10mb' }));
app.use(express.static('public'));
app.use(cookieParser());

app.use((req, res, next) => {
    const ct = req.headers['content-type'] || '';
    if (ct.includes('application/json')) {
        express.json()(req, res, next);
    } else if (ct.includes('application/x-www-form-urlencoded')) {
        express.urlencoded({ extended: true })(req, res, next);
    } else {
        next();
    }
});

// Game network telemetry endpoints: accept and discard client reports.
// These reports are non-critical and must never block login/download.
app.all('/api/network_logNetworkLogEvent', (req, res) => {
    res.status(204).end();
});
app.all('/api/network_log/NetworkLogEvent', (req, res) => {
    res.status(204).end();
});
app.all('/web_log/NetworkLogEvent', (req, res) => {
    res.status(204).end();
});

// ============ PROXY /GetLoginData ============
app.post('/GetLoginData', (req, res) => {
    const rawIp    = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
    const clientIp = rawIp.split(',')[0].trim().replace('::ffff:', '');
    const body     = req.body;

    const options = {
        hostname: 'loginbp.ggblueshark.com',
        path:     '/GetLoginData',
        method:   'POST',
        headers: {
            ...req.headers,
            'Host':           'loginbp.ggblueshark.com',
            'Content-Length': Buffer.isBuffer(body) ? body.length : 0
        }
    };

    const proxyReq = https.request(options, (proxyRes) => {
        const chunks = [];
        proxyRes.on('data', c => chunks.push(c));
        proxyRes.on('end', () => {
            const buffer = Buffer.concat(chunks);
            res.writeHead(proxyRes.statusCode, proxyRes.headers);
            res.end(buffer);
        });
    });

    proxyReq.on('error', (err) => {
        console.log(`[LOGIN] Proxy error: ${err.message}`);
        if (!res.headersSent) res.status(502).send('Proxy Error');
    });

    if (Buffer.isBuffer(body) && body.length > 0) proxyReq.write(body);
    proxyReq.end();
});

// ============ MODULES INIT ============
// Urutan penting — proxy paling akhir (catch-all)
if (modules.protobuf)  modules.protobuf.init(app);
if (modules.auth)      modules.auth.init(app);
if (modules.cdn)       modules.cdn.init(app);
if (modules.guest)     modules.guest.init(app);
if (modules.ping)      modules.ping.init(app);
if (modules.newbie)    app.post('/ChooseNewbieChoice', modules.newbie.handle);
if (modules.gamevar)   modules.gamevar.init(app);
if (modules.routes)    modules.routes.init(app);
if (modules.skin)      modules.skin.init(app);
if (modules['404'])    modules['404'].init(app);
if (modules.proxy)     modules.proxy.init(app); // selalu terakhir

app.listen(PORT, '0.0.0.0', () => {
    console.log(`[SERVER] Running on port ${PORT}`);
});

module.exports = app;
