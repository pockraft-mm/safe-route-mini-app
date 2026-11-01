import { createHmac, createPrivateKey, createPublicKey, sign, timingSafeEqual, verify, type KeyObject } from 'node:crypto';

type JwtConfiguration = {
  kid?: string;
} & ({ algorithm: 'HS256'; key: string } | { algorithm: 'RS256'; privateKey: KeyObject; publicKey: KeyObject });

export function getJwtConfiguration(value?: string): JwtConfiguration | null {
  return inspectJwtConfiguration(value).config;
}

export function inspectJwtConfiguration(value?: string): { config: JwtConfiguration | null; issue: string | null } {
  const invalid = (issue: string) => ({ config: null, issue });
  const valid = (config: JwtConfiguration) => ({ config, issue: null });
  if (!value?.trim()) return invalid('JWT_SECRET_MISSING');
  if (/{{\s*secrets\./.test(value)) return invalid('JWT_SECRET_REFERENCE_UNRESOLVED');
  let config: unknown;
  try { config = JSON.parse(value); } catch {
    if (/^[\s]*[\[{]/.test(value)) return invalid('JWT_CONFIG_JSON_INVALID');
    // Retain support for legacy raw HMAC secrets; never use a PEM as an HMAC key.
    return value.includes('-----BEGIN') ? invalid('JWT_CONFIG_JSON_INVALID') : valid({ algorithm: 'HS256', key: value });
  }
  // Some secret editors store an extra layer of JSON quoting.
  if (typeof config === 'string') {
    try { config = JSON.parse(config); } catch { return invalid('JWT_CONFIG_JSON_INVALID'); }
  }
  if (!config || typeof config !== 'object' || Array.isArray(config)) return invalid('JWT_CONFIG_INVALID');
  const fields = config as Record<string, unknown>;
  const kid = typeof fields.kid === 'string' ? fields.kid : undefined;
  if (fields.type === 'HS256') {
    if (typeof fields.key !== 'string' || !fields.key.trim()) return invalid('JWT_HMAC_KEY_MISSING');
    return valid({ algorithm: 'HS256', key: fields.key, kid });
  }
  if (fields.type === 'RS256') {
    if (typeof fields.signingKey !== 'string' || !fields.signingKey.trim()) return invalid('JWT_PRIVATE_KEY_MISSING');
    let privateKey: KeyObject;
    try {
      privateKey = createPrivateKey(normalizePem(fields.signingKey));
      if (privateKey.asymmetricKeyType !== 'rsa') return invalid('JWT_PRIVATE_KEY_INVALID');
    } catch { return invalid('JWT_PRIVATE_KEY_INVALID'); }
    let publicKey: KeyObject;
    try {
      publicKey = typeof fields.key === 'string' && fields.key.trim()
        ? createPublicKey(normalizePem(fields.key)) : createPublicKey(privateKey);
      if (publicKey.asymmetricKeyType !== 'rsa') return invalid('JWT_PUBLIC_KEY_INVALID');
    } catch { return invalid('JWT_PUBLIC_KEY_INVALID'); }
    if (createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }) !== publicKey.export({ type: 'spki', format: 'pem' })) return invalid('JWT_KEY_PAIR_MISMATCH');
    return valid({ algorithm: 'RS256', privateKey, publicKey, kid });
  }
  return invalid('JWT_ALGORITHM_UNSUPPORTED');
}

function normalizePem(value: string): string {
  return value.trim().replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\r\n/g, '\n');
}

export function signJwt(claims: Record<string, unknown>, config: JwtConfiguration): string {
  const header = { alg: config.algorithm, typ: 'JWT', ...(config.kid ? { kid: config.kid } : {}) };
  const unsigned = `${Buffer.from(JSON.stringify(header)).toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}`;
  const signature = config.algorithm === 'RS256'
    ? sign('RSA-SHA256', new Uint8Array(Buffer.from(unsigned)), config.privateKey)
    : createHmac('sha256', config.key).update(unsigned).digest();
  return `${unsigned}.${signature.toString('base64url')}`;
}

export function readJwtUserId(token: string | undefined, config: JwtConfiguration | null): string {
  if (!token || !config) return '';
  try {
    const parts = token.split('.');
    if (parts.length !== 3 || parts.some((part) => !part)) return '';
    const [header, payload, signature] = parts;
    const metadata = JSON.parse(Buffer.from(header, 'base64url').toString());
    if (metadata.alg !== config.algorithm || (metadata.kid && metadata.kid !== config.kid)) return '';
    const unsigned = `${header}.${payload}`;
    const received = Buffer.from(signature, 'base64url');
    if (config.algorithm === 'RS256') {
      if (!verify('RSA-SHA256', new Uint8Array(Buffer.from(unsigned)), config.publicKey, new Uint8Array(received))) return '';
    } else {
      const expected = createHmac('sha256', config.key).update(unsigned).digest();
      if (expected.length !== received.length || !timingSafeEqual(new Uint8Array(expected), new Uint8Array(received))) return '';
    }
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
    const now = Date.now() / 1000;
    if (typeof claims.exp !== 'number' || !Number.isFinite(claims.exp) || claims.exp <= now) return '';
    if (claims.nbf !== undefined && (typeof claims.nbf !== 'number' || !Number.isFinite(claims.nbf) || claims.nbf > now)) return '';
    return typeof claims.sub === 'string' ? claims.sub : '';
  } catch { return ''; }
}
