// modules/gamevar.js — Router untuk endpoint gamevar
// FIX: registerDummyEndpoints di sini dihapus (sudah di proxy.js)
//      Hanya endpoint unik gamevar yang di-register

const path = require('path');
const fs   = require('fs');
const { getVerConfig, fallbackConfig, registerDummyEndpoints } = require('../gamevar');

function sendConfig(req, res) {
    const userAgent    = req.headers['user-agent'] || '';
    const acceptHeader = req.headers['accept'] || '';
    const isBrowser    = /Mozilla|Chrome|Safari|Edge|Firefox|Opera/i.test(userAgent)
                         || acceptHeader.includes('text/html');

    if (isBrowser) {
        console.log('[GAMEVAR] Browser access blocked');
        return res.status(404).send('Not Found');
    }

    const rawIp    = req.headers['x-forwarded-for'] || req.socket.remoteAddress || "";
    const clientIp = rawIp.split(',')[0].trim().replace('::ffff:', '');
    console.log(`[GAMEVAR] Sending config to ${clientIp}`);

    res.json(getVerConfig(clientIp));
}

function sendFallbackConfig(req, res) {
    const userAgent    = req.headers['user-agent'] || '';
    const acceptHeader = req.headers['accept'] || '';
    const isBrowser    = /Mozilla|Chrome|Safari|Edge|Firefox|Opera/i.test(userAgent)
                         || acceptHeader.includes('text/html');

    if (isBrowser) return res.status(404).send('Not Found');

    const rawIp    = req.headers['x-forwarded-for'] || req.socket.remoteAddress || "";
    const clientIp = rawIp.split(',')[0].trim().replace('::ffff:', '');
    console.log(`[GAMEVAR] Fallback config to ${clientIp}`);

    // FIX: spread fallbackConfig agar getter 'gamevar' dieksekusi fresh
    res.json({ ...fallbackConfig, client_ip: clientIp });
}

function serveLocalConfig(req, res) {
    const dirPath  = path.join(__dirname, '..', 'files');
    const filePath = path.join(dirPath, 'localconfig.json');

    if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });

    if (!fs.existsSync(filePath)) {
        const defaultConfig = {
            resetGuest: true,
            verAddr: "https://proxy-reza-kontolodon-memek.up.railway.app/"
        };
        fs.writeFileSync(filePath, JSON.stringify(defaultConfig, null, 2));
    }

    res.download(filePath, 'localconfig.json', (err) => {
        if (err && !res.headersSent) {
            console.log(`[DOWNLOAD ERROR] ${err.message}`);
            res.status(500).send('Error downloading file');
        }
    });
}

function init(app) {
    // Register dummy GIN/GGP endpoints — hanya /api/gin_dummy & /api/web_dummy
    // (sisanya sudah di proxy.js registerTelemetryAbsorbers)
    registerDummyEndpoints(app);

    app.get('/ver.php',              sendConfig);
    app.get('/api/gamevar',          sendConfig);
    app.get('/api/gamevar/fallback', sendFallbackConfig);
    app.get('/localconfig.json',     serveLocalConfig);
}

module.exports = { init, sendConfig, sendFallbackConfig };
