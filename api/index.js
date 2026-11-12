const express = require('express');
const jwt = require('jsonwebtoken');
const fetch = require('node-fetch');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { rateLimit } = require('express-rate-limit');
const scrypt = promisify(crypto.scrypt);
const app = express();
app.disable('x-powered-by');
const origins = new Set(['https://www.fc.arq.br', 'https://fc.arq.br']);
const production = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production';
const cookieName = production ? '__Host-fc_session' : 'fc_session';
const cookieOptions = { httpOnly: true, secure: production, sameSite: 'strict', path: '/' };
const secret = process.env.JWT_SECRET;
const cache = new Map();
const inFlight = new Map();
app.use((req, res, next) => {
  res.set('Cache-Control', 'private, no-store');
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Robots-Tag', 'noindex, nofollow');
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    const origin = req.get('origin');
    const local = !production && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin || '');
    if ((!origins.has(origin) && !local) || req.get('sec-fetch-site') === 'cross-site') {
      return res.status(403).json({ erro: 'Origem não permitida' });
    }
  }
  next();
});
app.use(express.json({ limit: '4kb', inflate: false }));
function clients() {
  const result = [];
  for (let i = 0; process.env[`CLIENT_${i}_USER`]; i++) {
    result.push({ id: String(i), user: process.env[`CLIENT_${i}_USER`].toLowerCase(),
      pass: process.env[`CLIENT_${i}_PASS`], hash: process.env[`CLIENT_${i}_PASS_HASH`],
      url: process.env[`CLIENT_${i}_SCRIPT_URL`], key: process.env[`CLIENT_${i}_SCRIPT_KEY`] });
  }
  return result;
}
function equal(a, b) {
  const x = crypto.createHash('sha256').update(a).digest();
  const y = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(x, y);
}
async function passwordMatches(client, pass) {
  if (client.hash) {
    const [kind, salt, expected] = client.hash.split('$');
    if (kind !== 'scrypt' || !/^[a-f0-9]{32}$/.test(salt || '') || !/^[a-f0-9]{128}$/.test(expected || '')) return false;
    const derived = await scrypt(pass, salt, 64);
    return crypto.timingSafeEqual(derived, Buffer.from(expected, 'hex'));
  }
  // Compatibility while existing production credentials are migrated to hashes.
  return typeof client.pass === 'string' && equal(pass, client.pass);
}
const router = express.Router();
const loginLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false,
  message: { erro: 'Muitas tentativas. Aguarde 15 minutos.' } });
const accountLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: false, legacyHeaders: false,
  keyGenerator: req => crypto.createHash('sha256').update(typeof req.body?.user === 'string' ? req.body.user.trim().toLowerCase() : 'invalid').digest('hex'),
  message: { erro: 'Muitas tentativas. Aguarde 15 minutos.' } });
router.post('/login', loginLimit, accountLimit, async (req, res, next) => {
  try {
    const { user, pass } = req.body || {};
    if (typeof user !== 'string' || typeof pass !== 'string' || !user.trim() || !pass || user.length > 254 || pass.length > 256) return res.status(400).json({ erro: 'Dados inválidos' });
    if (!secret || secret.length < 32) return res.status(503).json({ erro: 'Autenticação indisponível' });
    const client = clients().find(c => c.user === user.trim().toLowerCase());
    if (!client || !await passwordMatches(client, pass)) return res.status(401).json({ erro: 'Credenciais inválidas' });
    const token = jwt.sign({}, secret, { subject: client.id, issuer: 'studiofc', audience: 'studiofc-client', expiresIn: '30m', algorithm: 'HS256' });
    res.cookie(cookieName, token, { ...cookieOptions, maxAge: 30 * 60 * 1000 });
    res.json({ expiresAt: Date.now() + 30 * 60 * 1000 });
  } catch (err) { next(err); }
});
router.post('/logout', (req, res) => { res.clearCookie(cookieName, cookieOptions); res.json({ ok: true }); });
router.get('/dados', async (req, res) => {
  let payload;
  try {
    const entry = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(cookieName + '='));
    payload = jwt.verify(entry ? entry.slice(cookieName.length + 1) : '', secret, { algorithms: ['HS256'], issuer: 'studiofc', audience: 'studiofc-client' });
  } catch { return res.status(401).json({ erro: 'Sessão expirada. Entre novamente.' }); }
  const client = clients().find(c => c.id === payload.sub);
  if (!client) return res.status(401).json({ erro: 'Sessão inválida' });
  const cacheKey = crypto.createHash('sha256').update(JSON.stringify([client.id, client.url, client.key])).digest('hex');
  const cached = cache.get(cacheKey);
  const refresh = req.query.refresh === '1';
  // Final do código de implantação do Apps Script: identifica qual implantação
  // este cliente lê, sem expor a URL. Serve para conferir em "Gerenciar implantações".
  let fonte = '';
  try { fonte = new URL(client.url).pathname.split('/')[3].slice(-4); } catch { /* URL inválida é tratada abaixo */ }
  const send = (entry, stale) => res.json({ ...entry.data, _cache: { stale, updatedAt: entry.ts, fonte } });
  if (!refresh && cached && Date.now() - cached.ts < 300000) return send(cached, false);
  try {
    if (!inFlight.has(cacheKey)) {
      const pending = (async () => {
    const url = new URL(client.url);
    if (url.protocol !== 'https:' || url.hostname !== 'script.google.com' || !/^\/macros\/s\/[^/]+\/exec$/.test(url.pathname)) throw new Error('Invalid upstream');
    const options = { timeout: 15000, size: 5 * 1024 * 1024 };
    if (client.key) {
      options.method = 'POST';
      options.headers = { 'Content-Type': 'application/json' };
      options.body = JSON.stringify({ key: client.key, refresh });
    } else if (refresh) {
      // Sem chave a consulta é GET; o refresh vai na query para furar o cache do script.
      url.searchParams.set('refresh', '1');
    }
    const response = await fetch(url.href, options);
    if (!response.ok) throw new Error('Upstream failed');
    const data = await response.json();
    if (!data || typeof data !== 'object' || Array.isArray(data) || data.erro) throw new Error('Invalid data');
    const entry = { data, ts: Date.now() };
    cache.set(cacheKey, entry);
    return entry;
      })();
      inFlight.set(cacheKey, pending);
      pending.finally(() => inFlight.delete(cacheKey)).catch(() => {});
    }
    return send(await inFlight.get(cacheKey), false);
  } catch {
    if (cached && Date.now() - cached.ts < 60 * 60 * 1000) return send(cached, true);
    return res.status(502).json({ erro: 'Dados temporariamente indisponíveis. Tente novamente.' });
  }
});
router.get('/health', (_, res) => res.json({ ok: true }));
app.use('/api', router);
app.use('/', router);
app.use((err, req, res, next) => {
  const status = err.status >= 400 && err.status < 500 ? err.status : 500;
  res.status(status).json({ erro: status === 500 ? 'Erro interno' : 'Requisição inválida' });
});
if (require.main === module) app.listen(process.env.PORT || 3000);
module.exports = app;
