// modules/cdn.js - CACHE_RES WAJIB LOKAL
// CDN hotpatch (abhotupdate) langsung ke sslip.io via gamevar, bukan lewat sini
const path = require('path');
const fs = require('fs');
const https = require('https');

const CDN_BASE = 'https://dl.cdn.freefiremobile.com';
const VERSION = '2.130.22';
const VERSIONS = [VERSION, '1.130.22', '1.126.3'];

function init(app) {
    const baseDir = path.join(__dirname, '..', 'public', 'cdn');

    app.use('/cdn', (req, res) => {
        const reqPath = req.path || '/';
        let isSent = false;

        console.log(`[CDN] 📥 ${reqPath}`);

        // ===== CACHE_RES: WAJIB DARI LOKAL =====
        if (reqPath.includes('cache_res')) {
            console.log(`[CDN] 🔒 CACHE_RES: LOCAL ONLY`);

            const possiblePaths = [
                path.join(baseDir, reqPath),
                path.join(baseDir, reqPath.replace('/live/ABHotUpdates', '')),
                ...VERSIONS.flatMap(v => [
                    path.join(baseDir, 'android_max_astc', v, 'gameassetbundles', path.basename(reqPath)),
                    path.join(baseDir, 'android_astc', v, 'gameassetbundles', path.basename(reqPath)),
                ]),
                path.join(baseDir, path.basename(reqPath)),
            ];

            for (const localFile of possiblePaths) {
                if (fs.existsSync(localFile)) {
                    const stat = fs.statSync(localFile);
                    if (stat.isFile() && stat.size > 0) {
                        console.log(`[CDN] ✅ CACHE_RES LOCAL: ${localFile} (${stat.size} bytes)`);
                        res.setHeader('Content-Type', 'application/octet-stream');
                        return res.status(200).send(fs.readFileSync(localFile));
                    }
                }
            }

            console.log(`[CDN] ❌ CACHE_RES NOT FOUND LOCAL`);
            return res.status(200).json({
                code: 0,
                message: 'Cache_res not available locally',
                path: reqPath
            });
        }

        // ===== FILEINFO: CEK LOKAL DULU =====
        if (reqPath.includes('fileinfo')) {
            const possiblePaths = [
                path.join(baseDir, reqPath),
                ...VERSIONS.flatMap(v => [
                    path.join(baseDir, 'android_max_astc', v, 'fileinfo'),
                    path.join(baseDir, 'android_astc', v, 'fileinfo'),
                ]),
            ];
            for (const localFile of possiblePaths) {
                if (fs.existsSync(localFile)) {
                    const stat = fs.statSync(localFile);
                    if (stat.isFile() && stat.size > 0) {
                        console.log(`[CDN] ✅ FILEINFO LOCAL: ${localFile}`);
                        res.setHeader('Content-Type', 'application/octet-stream');
                        return res.status(200).send(fs.readFileSync(localFile));
                    }
                }
            }
            // fallthrough ke garena
        }

        // ===== FILE LAIN: AMBIL DARI GARENA =====
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
                    isSent = true;
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
            isSent = true;
            cdnReq.destroy();
            console.log(`[CDN] ⏰ TIMEOUT`);
            res.status(200).json({ code: 0, message: 'CDN timeout', path: reqPath });
        });
    });
}

module.exports = { init };
