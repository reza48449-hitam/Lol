const https = require('https');

const GARENA_LOGIN_SERVER  = 'https://loginbp.ggblueshark.com';
const GARENA_CLIENT_SERVER = 'https://clientbp.ggpolarbear.com';

function stripTelemetry(buf) {
    if (!Buffer.isBuffer(buf) || !buf.length) return buf;
    try {
        const str = buf.toString('utf-8');
        if (!str.trim().startsWith('{')) return buf;
        const json = JSON.parse(str);

        const KILL = [
            'network_log_server', 'web_log_server',
            'CECNLHCONMI', 'GGPCHECKHASH', 'GGPCONFIG',
            'FOGGNIHIBPG', 'LJAPOJNBOFE',
            'EMFPDECPCDG', 'PDJHKBDIHGL', 'IIPKMIOFCJP',
            'DEVICECHECK', 'ANTIADDICTION',
            'ROOT_DETECTED', 'EMULATOR_DETECTED',
            'HOOK_DETECTED', 'MODIFIER_DETECTED',
            'JAILBREAK_DETECTED',
        ];

        for (const f of KILL) {
            if (json[f] !== undefined) {
                if (typeof json[f] === 'string')  json[f] = '';
                else if (typeof json[f] === 'boolean') json[f] = false;
                else json[f] = null;
            }
        }

        json.network_log_server = '';
        json.web_log_server     = '';

        return Buffer.from(JSON.stringify(json));
    } catch (e) { return buf; }
}

async function forwardRequest(req, res, targetUrl) {
    const target = new URL(targetUrl);
    const body   = Buffer.isBuffer(req.body) && req.body.length > 0 ? req.body : null;

    const headers = {
        ...req.headers,
        'Host': target.host,
    };

    if (body) headers['Content-Length'] = body.length;
    else {
        delete headers['content-length'];
        delete headers['Content-Length'];
    }

    return new Promise(resolve => {
        const pr = https.request({
            hostname: target.hostname, port: 443,
            path: req.url, method: req.method,
            headers, rejectUnauthorized: false,
            timeout: 12000,
        }, proxyRes => {
            const chunks = [];
            proxyRes.on('data', c => chunks.push(c));
            proxyRes.on('end', () => {
                let buf = Buffer.concat(chunks);
                buf = stripTelemetry(buf);

                res.writeHead(proxyRes.statusCode, proxyRes.headers);
                res.end(buf);
                resolve();
            });
        });

        pr.on('error', err => {
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

function isClientPath(p) {
    const lp = p.toLowerCase();
    return lp.includes('personal') || lp.includes('player') || lp.includes('client') ||
           lp.includes('pet')      || lp.includes('friend') || lp.includes('clan')   ||
           lp.includes('workshop') || lp.includes('splash') || lp.includes('desc')   ||
           lp.includes('profile')  || lp.includes('ranking')|| lp.includes('getlogindata') ||
           lp.includes('loginget');
}

const SKIP_PREFIXES = ['/cdn/', '/freefireth/', '/auth/', '/api/', '/health', '/status'];
const SKIP_EXACT    = new Set(['/ver.php', '/localconfig.json', '/api/gamevar', '/api/proxy/status']);
const SKIP_EXT      = /\.(jpg|png|gif|css|js|html?)$/i;

function shouldSkip(p) {
    if (SKIP_EXACT.has(p)) return true;
    if (SKIP_EXT.test(p))  return true;
    for (const prefix of SKIP_PREFIXES)
        if (p.startsWith(prefix)) return true;
    return false;
}

function init(app) {
    app.all('*', async (req, res, next) => {
        const p = req.path;
        if (shouldSkip(p)) return next();

        const target = isClientPath(p) ? GARENA_CLIENT_SERVER : GARENA_LOGIN_SERVER;
        await forwardRequest(req, res, target + req.url);
    });

    console.log('[PROXY] Simple bypass ON');
}

module.exports = { init };