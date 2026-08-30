// modules/cdn.js - CACHE_RES WAJIB LOKAL + support /freefireth/ path (SX2)
const path = require('path');
const fs = require('fs');
const https = require('https');

const CDN_BASE = 'https://dl.cdn.freefiremobile.com';
const VERSION = '1.130.22';

function serveLocal(res, filePath) {
    if (fs.existsSync(filePath)) {
        const stat = fs.statSync(filePath);
        if (stat.isFile() && stat.size > 0) {
            res.setHeader('Content-Type', 'application/octet-stream');
            res.status(200).send(fs.readFileSync(filePath));
            return true;
        }
    }
    return false;
}

function init(app) {
    const baseDir = path.join(__dirname, '..', 'public', 'cdn');
    const freefirethDir = path.join(__dirname, '..', 'freefireth');

    // ===== ROUTE /freefireth/ — endpoint SX2 =====
    app.use('/freefireth', (req, res) => {
        const reqPath = req.path || '/';
        console.log(`[FREEFIRETH] 📥 ${reqPath}`);

        const localFile = path.join(freefirethDir, reqPath);
        if (serveLocal(res, localFile)) {
            console.log(`[FREEFIRETH] ✅ LOCAL: ${localFile}`);
            return;
        }

        let targetPath = `/live/ABHotUpdates${reqPath.replace('/live/ABHotUpdates', '')}`;
        const target = CDN_BASE + targetPath;
        console.log(`[FREEFIRETH] 🚀 GARENA: ${target}`);

        const cdnReq = https.get(target, {
            headers: {
                'User-Agent': 'Dalvik/2.1.0 (Linux; U; Android 11; SM-G998B)',
                'Accept': '*/*',
                'Host': 'dl.cdn.freefiremobile.com'
            }
        }, (cdnRes) => {
            let data = [];
            cdnRes.on('data', chunk => data.push(chunk));
            cdnRes.on('end', () => {
                const buffer = Buffer.concat(data);
                if (cdnRes.statusCode === 200) {
                    try {
                        const dir = path.dirname(localFile);
                        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                        fs.writeFileSync(localFile, buffer);
                        console.log(`[FREEFIRETH] 💾 SAVED: ${localFile}`);
                    } catch (e) {}
                    res.setHeader('Content-Type', cdnRes.headers['content-type'] || 'application/octet-stream');
                    return res.status(200).send(buffer);
                }
                res.status(404).json({ code: 404, message: 'Not found', path: reqPath });
            });
        });

        cdnReq.on('error', (err) => {
            console.log(`[FREEFIRETH] ⚠️ ${err.message}`);
            res.status(200).json({ code: 0, message: 'CDN error', path: reqPath });
        });

        cdnReq.setTimeout(8000, () => {
            cdnReq.destroy();
            res.status(200).json({ code: 0, message: 'CDN timeout', path: reqPath });
        });
    });

    // ===== ROUTE /cdn/ — endpoint utama =====
    app.use('/cdn', (req, res) => {
        const reqPath = req.path || '/';
        let isSent = false;

        console.log(`[CDN] 📥 ${reqPath}`);

        if (reqPath.includes('cache_res')) {
            console.log(`[CDN] 🔒 CACHE_RES: LOCAL ONLY`);

            const possiblePaths = [
                path.join(baseDir, reqPath),
                path.join(baseDir, reqPath.replace('/live/ABHotUpdates', '')),
                path.join(baseDir, 'gameassetbundles', path.basename(reqPath)),
                path.join(baseDir, 'android_max_astc', VERSION, 'gameassetbundles', path.basename(reqPath)),
                path.join(baseDir, 'android_max_astc', '1.126.3', 'gameassetbundles', path.basename(reqPath)),
                path.join(baseDir, path.basename(reqPath)),
            ];

            for (const localFile of possiblePaths) {
                if (serveLocal(res, localFile)) {
                    console.log(`[CDN] ✅ CACHE_RES LOCAL: ${localFile}`);
                    return;
                }
            }

            console.log(`[CDN] ❌ CACHE_RES NOT FOUND LOCAL`);
            return res.status(200).json({ code: 0, message: 'Cache_res not available locally', path: reqPath });
        }

        if (reqPath.includes('fileinfo')) {
            const localFile = path.join(baseDir, reqPath);
            if (serveLocal(res, localFile)) {
                console.log(`[CDN] ✅ FILEINFO LOCAL: ${localFile}`);
                return;
            }
        }

        let targetPath = reqPath;
        if (!targetPath.includes('/live/ABHotUpdates/')) {
            targetPath = `/live/ABHotUpdates${targetPath}`;
        }
        if (targetPath.includes('/1.126.3/')) {
            targetPath = targetPath.replace('/1.126.3/', `/${VERSION}/`);
        }
        if (targetPath.includes('/OB54/')) {
            targetPath = targetPath.replace('/OB54/', `/${VERSION}/`);
        }

        const target = CDN_BASE + targetPath;
        console.log(`[CDN] 🚀 GARENA: ${target}`);

        const cdnReq = https.get(target, {
            headers: {
                'User-Agent': 'Dalvik/2.1.0 (Linux; U; Android 11; SM-G998B)',
                'Accept': '*/*',
                'Accept-Encoding': 'gzip, deflate',
                'Accept-Language': 'id-ID,en-US;q=0.9',
                'Connection': 'keep-alive',
                'Host': 'dl.cdn.freefiremobile.com'
            }
        }, (cdnRes) => {
            if (isSent) return;

            let data = [];
            cdnRes.on('data', chunk => data.push(chunk));
            cdnRes.on('end', () => {
                if (isSent) return;
                const buffer = Buffer.concat(data);

                if (cdnRes.statusCode === 200) {
                    console.log(`[CDN] ✅ GARENA: ${buffer.length} bytes`);

                    if (!reqPath.includes('cache_res')) {
                        try {
                            const savePath = path.join(baseDir, reqPath);
                            const dir = path.dirname(savePath);
                            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                            fs.writeFileSync(savePath, buffer);
                            console.log(`[CDN] 💾 SAVED: ${savePath}`);
                        } catch (e) {}
                    }

                    res.setHeader('Content-Type', cdnRes.headers['content-type'] || 'application/octet-stream');
                    return res.status(200).send(buffer);
                }

                console.log(`[CDN] ❌ ${cdnRes.statusCode}`);
                isSent = true;
                res.status(200).json({ code: 0, message: 'File not available', path: reqPath });
            });
        });

        cdnReq.on('error', (err) => {
            if (isSent) return;
            console.log(`[CDN] ⚠️ ${err.message}`);
            isSent = true;
            res.status(200).json({ code: 0, message: 'CDN error', path: reqPath });
        });

        cdnReq.setTimeout(5000, () => {
            if (isSent) return;
            cdnReq.destroy();
            console.log(`[CDN] ⏰ TIMEOUT`);
            isSent = true;
            res.status(200).json({ code: 0, message: 'CDN timeout', path: reqPath });
        });
    });
}

module.exports = { init };
