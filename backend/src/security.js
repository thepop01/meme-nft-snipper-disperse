import { timingSafeEqual } from 'node:crypto';

const LOCAL_MODES = new Set(['development', 'test']);
const SENSITIVE_QUERY_PARAMETER = /(?:key|token|secret|password|passwd|credential|authorization|signature|^auth$)/i;

function normalizedString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function isLoopbackHost(host) {
  const normalized = normalizedString(host).toLowerCase();
  return normalized === 'localhost'
    || normalized === '127.0.0.1'
    || normalized === '::1'
    || normalized === '[::1]';
}

export function parseCorsOrigins(value) {
  const values = Array.isArray(value) ? value : String(value || '').split(',');
  const origins = [...new Set(values.map(normalizedString).filter(Boolean))];
  if (origins.includes('*')) {
    throw new Error('CORS_ORIGINS must contain explicit origins; wildcard (*) is not allowed');
  }
  return origins;
}

export function securityConfigFromEnv(env = process.env) {
  const nodeEnv = normalizedString(env.NODE_ENV || 'production').toLowerCase() || 'production';
  const host = normalizedString(env.HOST || '127.0.0.1') || '127.0.0.1';
  const apiToken = normalizedString(env.API_TOKEN);
  const localAuthExplicitlyEnabled = env.ALLOW_INSECURE_LOCAL_AUTH === undefined
    || String(env.ALLOW_INSECURE_LOCAL_AUTH).toLowerCase() === 'true';
  const allowUnauthenticated = LOCAL_MODES.has(nodeEnv)
    && isLoopbackHost(host)
    && localAuthExplicitlyEnabled
    && !apiToken;

  return {
    nodeEnv,
    host,
    apiToken,
    allowUnauthenticated,
    corsOrigins: (() => {
      const parsed = parseCorsOrigins(env.CORS_ORIGINS);
      if (parsed.length > 0) return parsed;
      return (isLoopbackHost(host) || LOCAL_MODES.has(nodeEnv))
        ? ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:5174', 'http://127.0.0.1:5174']
        : [];
    })(),
  };
}

export function createCorsOptions({ corsOrigins = [] } = {}) {
  const allowedOrigins = new Set(parseCorsOrigins(corsOrigins));
  return {
    // Same-origin requests do not send Origin. Cross-origin requests must use
    // an exact configured origin; in particular, never reflect arbitrary input.
    origin(origin, callback) {
      if (!origin) return callback(null, false);
      return callback(null, allowedOrigins.has(origin) ? origin : false);
    },
    credentials: false,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type'],
    optionsSuccessStatus: 204,
  };
}

export function extractBearerToken(authorization) {
  const value = Array.isArray(authorization) ? authorization[0] : authorization;
  if (typeof value !== 'string') return null;
  const match = /^Bearer[ \t]+(.+)$/i.exec(value.trim());
  return match ? match[1].trim() : null;
}

export function tokensMatch(provided, expected) {
  const supplied = normalizedString(provided);
  const configured = normalizedString(expected);
  if (!supplied || !configured) return false;
  const suppliedBytes = Buffer.from(supplied);
  const configuredBytes = Buffer.from(configured);
  if (suppliedBytes.length !== configuredBytes.length) return false;
  return timingSafeEqual(suppliedBytes, configuredBytes);
}

export function requestHasValidToken(req, expectedToken) {
  return tokensMatch(extractBearerToken(req?.headers?.authorization), expectedToken);
}

export function extractWebSocketToken(req) {
  const authorizationToken = extractBearerToken(req?.headers?.authorization);
  if (authorizationToken) return authorizationToken;
  const protocols = String(req?.headers?.['sec-websocket-protocol'] || '')
    .split(',').map(value => value.trim()).filter(Boolean);
  const encoded = protocols.find(value => value.startsWith('bearer.'))?.slice('bearer.'.length);
  if (!encoded) return null;
  try {
    return Buffer.from(encoded, 'base64url').toString('utf8');
  } catch {
    return null;
  }
}

export function requestHasValidWebSocketToken(req, expectedToken) {
  return tokensMatch(extractWebSocketToken(req), expectedToken);
}

export function createAuthMiddleware({ apiToken = '', allowUnauthenticated = false } = {}) {
  const configuredToken = normalizedString(apiToken);
  return (req, res, next) => {
    if (allowUnauthenticated && !configuredToken) return next();
    if (requestHasValidToken(req, configuredToken)) return next();
    res.set('WWW-Authenticate', 'Bearer');
    return res.status(401).json({ error: 'Unauthorized' });
  };
}

export function maskRpcUrl(value) {
  const raw = String(value ?? '');
  try {
    const url = new URL(raw);
    // Credentials and fragments should never be returned as part of a status
    // response. Keep non-sensitive query parameters for useful diagnostics.
    url.username = '';
    url.password = '';
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (SENSITIVE_QUERY_PARAMETER.test(key)) url.searchParams.set(key, '***');
    }
    url.pathname = url.pathname.split('/').map(segment =>
      /^[0-9a-zA-Z_-]{20,}$/.test(segment) ? '***' : segment).join('/');
    return url.toString();
  } catch {
    // Preserve the old best-effort behavior for malformed URLs while covering
    // common secret-bearing query spellings and casing.
    return raw.replace(/([?&](?:api[-_]?key|token|secret|password|passwd|key)=)[^&#\s]*/gi, '$1***');
  }
}
