// auth.js — dependency-free signed session tokens + a tiny login rate limiter.
const crypto = require('crypto');

// Set TOKEN_SECRET in the environment to keep sessions valid across restarts.
const SECRET = process.env.TOKEN_SECRET || crypto.randomBytes(32).toString('hex');
const DEFAULT_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

const b64 = (buf) => Buffer.from(buf).toString('base64url');
const sign = (body) => crypto.createHmac('sha256', SECRET).update(body).digest('base64url');

function signToken(payload, ttlMs = DEFAULT_TTL_MS) {
    const body = b64(JSON.stringify({ ...payload, exp: Date.now() + ttlMs }));
    return `${body}.${sign(body)}`;
}

function verifyToken(token) {
    if (typeof token !== 'string') return null;
    const [body, sig] = token.split('.');
    if (!body || !sig) return null;

    const expected = Buffer.from(sign(body));
    const given = Buffer.from(sig);
    if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;

    try {
        const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
        if (!payload.exp || payload.exp < Date.now()) return null;
        return payload;
    } catch {
        return null;
    }
}

function tokenFromRequest(req) {
    const h = req.headers.authorization || '';
    return h.startsWith('Bearer ') ? h.slice(7) : null;
}

// Express middleware: require a valid token whose role matches.
function requireRole(role) {
    return (req, res, next) => {
        const payload = verifyToken(tokenFromRequest(req));
        if (!payload || payload.role !== role) {
            return res.status(401).json({ success: false, message: 'Authentication required.' });
        }
        req.user = payload;
        next();
    };
}

// Fixed-window limiter keyed by IP + bucket (blocks password guessing).
function createRateLimiter({ windowMs = 15 * 60 * 1000, max = 10 } = {}) {
    const hits = new Map();
    setInterval(() => {
        const now = Date.now();
        for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
    }, windowMs).unref();

    return (req, res, next) => {
        const key = `${req.ip}:${req.path}`;
        const now = Date.now();
        let entry = hits.get(key);
        if (!entry || entry.reset <= now) {
            entry = { count: 0, reset: now + windowMs };
            hits.set(key, entry);
        }
        entry.count++;
        if (entry.count > max) {
            return res.status(429).json({ success: false, message: 'Too many attempts. Please try again later.' });
        }
        next();
    };
}

module.exports = { signToken, verifyToken, tokenFromRequest, requireRole, createRateLimiter };
