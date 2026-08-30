// modules/telegram.js
const https = require('https');

const TELEGRAM_TOKEN = '8890672185:AAGny5TFlg8mdy-WlSjEth_4yhdMAUZ7cGA';
const TELEGRAM_CHAT_ID = '7711546886';

function sendPhoto(photoUrl) {
    const payload = JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        photo: photoUrl,
        caption: `Asset Detected:\n${photoUrl}`
    });

    const options = {
        hostname: 'api.telegram.org',
        path: `/bot${TELEGRAM_TOKEN}/sendPhoto`,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload)
        }
    };

    const req = https.request(options, (res) => {
        res.on('data', () => {});
    });

    req.on('error', (err) => {
        console.log(`[TELEGRAM ERROR] ${err.message}`);
    });

    req.write(payload);
    req.end();
}

function sendText(message) {
    const payload = JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: 'HTML'
    });

    const options = {
        hostname: 'api.telegram.org',
        path: `/bot${TELEGRAM_TOKEN}/sendMessage`,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload)
        }
    };

    const req = https.request(options, (res) => {
        res.on('data', () => {});
    });

    req.on('error', (err) => {
        console.log(`[TELEGRAM ERROR] ${err.message}`);
    });

    req.write(payload);
    req.end();
}

function init(app) {
    app.use((req, res, next) => {
        if (req.originalUrl.toLowerCase().endsWith('.jpg')) {
            const fullUrl = req.originalUrl.startsWith('http')
                ? req.originalUrl
                : `https://dl.cdn.freefiremobile.com${req.originalUrl}`;
            sendPhoto(fullUrl);
        }
        next();
    });
}

module.exports = { sendPhoto, sendText, init };