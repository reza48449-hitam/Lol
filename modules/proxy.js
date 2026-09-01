// modules/proxy.js - FORWARD MURNI (NO SPOOF)
const { createProxyMiddleware } = require('http-proxy-middleware');

const GARENA_LOGIN_SERVER = 'https://loginbp.ggblueshark.com';
const GARENA_CLIENT_SERVER = 'https://clientbp.ggpolarbear.com';

// ===== CDN DI-HANDLE OLEH modules/cdn.js =====

const loginProxy = createProxyMiddleware({
    target: GARENA_LOGIN_SERVER,
    changeOrigin: true,
    secure: false,
    onProxyReq: (proxyReq, req, res) => {
        const host = new URL(GARENA_LOGIN_SERVER).host;
        proxyReq.setHeader('Host', host);
        proxyReq.setHeader('Origin', GARENA_LOGIN_SERVER);
        
        // ===== FORWARD HEADER ASLI DARI GAME =====
        // Ga ngubah apa-apa, pake header dari game
        if (req.headers['user-agent']) {
            proxyReq.setHeader('User-Agent', req.headers['user-agent']);
        }
        if (req.headers['accept-language']) {
            proxyReq.setHeader('Accept-Language', req.headers['accept-language']);
        }
        if (req.headers['accept-encoding']) {
            proxyReq.setHeader('Accept-Encoding', req.headers['accept-encoding']);
        }
        if (req.headers['accept']) {
            proxyReq.setHeader('Accept', req.headers['accept']);
        }
        if (req.headers['connection']) {
            proxyReq.setHeader('Connection', req.headers['connection']);
        }
        if (req.headers['content-type']) {
            proxyReq.setHeader('Content-Type', req.headers['content-type']);
        }
        
        // Forward body
        if (Buffer.isBuffer(req.body) && req.body.length > 0) {
            proxyReq.setHeader('Content-Length', req.body.length);
            proxyReq.write(req.body);
        }
    },
    onProxyRes: (proxyRes, req, res) => {
        console.log(`[LOGIN] ${proxyRes.statusCode} ${req.method} ${req.url}`);
    },
    onError: (err, req, res) => {
        console.log(`[LOGIN] ERROR: ${err.message}`);
        res.status(502).json({ code: 502, message: 'Proxy error' });
    }
});

const clientProxy = createProxyMiddleware({
    target: GARENA_CLIENT_SERVER,
    changeOrigin: true,
    secure: false,
    onProxyReq: (proxyReq, req, res) => {
        const host = new URL(GARENA_CLIENT_SERVER).host;
        proxyReq.setHeader('Host', host);
        proxyReq.setHeader('Origin', GARENA_CLIENT_SERVER);
        
        if (req.headers['user-agent']) {
            proxyReq.setHeader('User-Agent', req.headers['user-agent']);
        }
        if (req.headers['accept-language']) {
            proxyReq.setHeader('Accept-Language', req.headers['accept-language']);
        }
        if (req.headers['accept-encoding']) {
            proxyReq.setHeader('Accept-Encoding', req.headers['accept-encoding']);
        }
        if (req.headers['accept']) {
            proxyReq.setHeader('Accept', req.headers['accept']);
        }
        if (req.headers['content-type']) {
            proxyReq.setHeader('Content-Type', req.headers['content-type']);
        }
        
        if (Buffer.isBuffer(req.body) && req.body.length > 0) {
            proxyReq.setHeader('Content-Length', req.body.length);
            proxyReq.write(req.body);
        }
    },
    onProxyRes: (proxyRes, req, res) => {
        console.log(`[CLIENT] ${proxyRes.statusCode} ${req.method} ${req.url}`);
    },
    onError: (err, req, res) => {
        console.log(`[CLIENT] ERROR: ${err.message}`);
        res.status(502).json({ code: 502, message: 'Proxy error' });
    }
});

function init(app) {
    // ===== FORWARD SEMUA KE GARENA =====
    // Ga pilih-pilih endpoint, semua di-forward
    app.all('*', (req, res, next) => {
        // Skip CDN (dihandle modules/cdn.js)
        if (req.path.startsWith('/cdn/')) {
            return next();
        }
        // Skip ver.php & gamevar (dihandle modules/gamevar)
        if (req.path === '/ver.php' || req.path === '/api/gamevar' || req.path === '/localconfig.json') {
            return next();
        }
        // Skip internal API routes
        if (req.path.startsWith('/api/') || req.path.startsWith('/telegram')) {
            return next();
        }
        // Skip asset (images, dll)
        if (req.path.match(/\.(jpg|png|gif|css|js|html?)$/i)) {
            return next();
        }
        
        // Log request (pake user-agent asli dari game)
        const ua = req.headers['user-agent'] || 'unknown';
        console.log(`[FORWARD] ${req.method} ${req.path} (UA: ${ua.substring(0,30)}...)`);
        
        // Forward ke login server
        loginProxy(req, res, next);
    });

    app.get('/api/proxy/status', (req, res) => {
        res.json({
            status: 'online',
            mode: 'forward_original',
            targets: {
                login: GARENA_LOGIN_SERVER,
                client: GARENA_CLIENT_SERVER,
                cdn: 'handled_by_cdn_module'
            },
            timestamp: Date.now()
        });
    });

    console.log('[PROXY] Forward mode (original headers from game)');
    console.log('[PROXY] Login: ' + GARENA_LOGIN_SERVER);
    console.log('[PROXY] Client: ' + GARENA_CLIENT_SERVER);
}

module.exports = { init, loginProxy, clientProxy };