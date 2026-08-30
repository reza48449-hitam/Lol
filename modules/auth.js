// modules/auth.js
const crypto = require('crypto');

const VALID_KEYS = ['EPEP123', 'NIKU456', 'RAFIN789', 'ADMIN999'];
const userSessions = new Map();

function checkAuth(req, res, next) {
    const sessionId = req.cookies?.sessionId || req.headers['x-session-id'];
    if (!sessionId || !userSessions.has(sessionId)) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    const session = userSessions.get(sessionId);
    if (Date.now() > session.expires) {
        userSessions.delete(sessionId);
        return res.status(401).json({ error: 'Session expired' });
    }
    req.session = session;
    next();
}

function init(app) {
    app.post('/auth/login', (req, res) => {
        const { key } = req.body;
        if (!VALID_KEYS.includes(key)) {
            return res.json({ success: false, message: 'Invalid key' });
        }
        const sessionId = crypto.randomBytes(16).toString('hex');
        const rawIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || "";
        const clientIp = rawIp.split(',')[0].trim().replace('::ffff:', '');
        userSessions.set(sessionId, {
            ip: clientIp,
            key: key,
            expires: Date.now() + 24 * 60 * 60 * 1000
        });
        res.json({ success: true, sessionId });
    });

    app.post('/auth/logout', checkAuth, (req, res) => {
        const sessionId = req.cookies?.sessionId || req.headers['x-session-id'];
        if (sessionId) userSessions.delete(sessionId);
        res.json({ success: true });
    });
}

module.exports = { init, checkAuth };