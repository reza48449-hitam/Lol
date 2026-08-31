const express = require('express');
const path = require('path');
const fs = require('fs');
const cookieParser = require('cookie-parser');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3030;

// ============ MODULES LOADER ============
function loadModules() {
    const modulesPath = path.join(__dirname, 'modules');
    if (!fs.existsSync(modulesPath)) return {};
    const modules = {};
    const files = fs.readdirSync(modulesPath).filter(f => f.endsWith('.js'));
    for (const file of files) {
        try {
            const modulePath = path.join(modulesPath, file);
            const module = require(modulePath);
            const name = path.basename(file, '.js');
            modules[name] = module;
        } catch (err) {
            console.log(`[ERROR] Load module ${file}: ${err.message}`);
        }
    }
    return modules;
}

const modules = loadModules();

// ============ USER-AGENT RANDOMIZER ============
const userAgents = [
    'Dalvik/2.1.0 (Linux; U; Android 11; SM-G998B Build/RP1A.200720.012)',
    'Dalvik/2.1.0 (Linux; U; Android 12; SM-G990E Build/SP1A.210812.016)',
    'Dalvik/2.1.0 (Linux; U; Android 13; SM-A536E Build/TP1A.220624.014)',
    'Dalvik/2.1.0 (Linux; U; Android 12; M2010J19SG Build/SKQ1.210908.001)',
    'Dalvik/2.1.0 (Linux; U; Android 13; M2101K7BG Build/TKQ1.220829.002)',
    'Dalvik/2.1.0 (Linux; U; Android 11; CPH2239 Build/RP1A.200720.011)',
    'Dalvik/2.1.0 (Linux; U; Android 12; CPH2251 Build/SP1A.210812.016)',
    'Dalvik/2.1.0 (Linux; U; Android 12; V2204 Build/SP1A.210812.016)',
    'Dalvik/2.1.0 (Linux; U; Android 11; RMX2151 Build/RP1A.200720.011)',
    'Dalvik/2.1.0 (Linux; U; Android 11; ASUS_I005DA Build/RP1A.200720.012)',
    'Dalvik/2.1.0 (Linux; U; Android 13; Pixel 7 Build/UQ1A.231205.015)',
];

const languages = ['id-ID', 'en-US', 'th-TH', 'vi-VN', 'ms-MY', 'zh-TW'];

function getRandomUA() {
    const ua = userAgents[Math.floor(Math.random() * userAgents.length)];
    const lang = languages[Math.floor(Math.random() * languages.length)];
    return { ua, lang };
}

// ============ MIDDLEWARE ============
app.use(express.raw({ type: '*/*', limit: '10mb' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use(cookieParser());

app.use((req, res, next) => {
    const { ua, lang } = getRandomUA();
    req.headers['user-agent'] = ua;
    req.headers['accept-language'] = lang;
    next();
});

// ============ DEVICE INFO ============
app.get('/api/device', (req, res) => {
    const rawIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || "";
    const clientIp = rawIp.split(',')[0].trim().replace('::ffff:', '');
    const ua = req.headers['user-agent'] || 'Unknown';
    let deviceName = 'Unknown';
    let platform = 'Unknown';
    if (ua.includes('Android')) { platform = 'Android'; const match = ua.match(/\(([^)]+)\)/); if (match) deviceName = match[1]; }
    else if (ua.includes('iPhone') || ua.includes('iPad')) { platform = 'iOS'; deviceName = ua.match(/iPhone|iPad/)[0]; }
    else if (ua.includes('Windows')) { platform = 'Windows'; deviceName = 'PC'; }
    else if (ua.includes('Mac')) { platform = 'macOS'; deviceName = 'Mac'; }
    else if (ua.includes('Linux')) { platform = 'Linux'; deviceName = 'Linux'; }
    const acceptLang = req.headers['accept-language'] || 'en-US';
    const language = acceptLang.split(',')[0];
    res.json({ ip: clientIp || '0.0.0.0', device: deviceName, platform: platform, language: language, userAgent: ua, timestamp: Date.now() });
});

// ============ PROXY /GetLoginData ============
app.post('/GetLoginData', (req, res) => {
    const options = {
        hostname: 'loginbp.ggblueshark.com',
        path: '/GetLoginData', 
        method: 'POST',
        headers: { 
            ...req.headers, 
            'Host': 'loginbp.ggblueshark.com', 
            'Content-Length': req.body?.length || 0 
        }
    };
    const proxyReq = https.request(options, (proxyRes) => {
        let responseData = [];
        proxyRes.on('data', (chunk) => responseData.push(chunk));
        proxyRes.on('end', () => {
            const buffer = Buffer.concat(responseData);
            res.writeHead(proxyRes.statusCode, proxyRes.headers);
            res.end(buffer);
        });
    });
    proxyReq.on('error', (err) => { res.status(500).send('Proxy Error'); });
    if (req.body) proxyReq.write(req.body);
    proxyReq.end();
});

// ============ MODULES INIT ============
if (modules.logger) modules.logger.init(app);
if (modules.telegram) modules.telegram.init(app);
if (modules.protobuf) modules.protobuf.init(app);
if (modules.auth) modules.auth.init(app);
if (modules.proxy) modules.proxy.init(app);
if (modules.cdn) modules.cdn.init(app);
if (modules.guest) modules.guest.init(app);
if (modules.ping) modules.ping.init(app);
if (modules.newbie) app.post('/ChooseNewbieChoice', modules.newbie.handle);
if (modules.gamevar) modules.gamevar.init(app);
if (modules.routes) modules.routes.init(app);
if (modules.skin) modules.skin.init(app);
if (modules['404']) modules['404'].init(app);

app.listen(PORT, '0.0.0.0', () => {
    console.log(`[SERVER] Running on port ${PORT}`);
});

// ============ EXPORT UNTUK VERCEL ============
module.exports = app;