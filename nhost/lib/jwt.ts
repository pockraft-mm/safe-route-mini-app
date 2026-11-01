import { createHmac, createPrivateKey, createPublicKey, sign, timingSafeEqual, verify, type KeyObject } from 'node:crypto';

type JwtConfiguration = {
  kid?: string;
} & ({ algorithm: 'HS256'; key: string } | { algorithm: 'RS256'; privateKey: KeyObject; publicKey: KeyObject });

export function getJwtConfiguration(value?: string): JwtConfiguration | null {
  if (!value?.trim()) return null;
  let config: unknown;
  try { config = JSON.parse(value); } catch {
    // Retain support for legacy raw HMAC secrets; never use a PEM as an HMAC key.
    return value.includes('-----BEGIN') ? null : { algorithm: 'HS256', key: value };
  }
  if (!config || typeof config !== 'object' || Array.isArray(config)) return null;
  const fields = config as Record<string, unknown>;
  const kid = typeof fields.kid === 'string' ? fields.kid : undefined;
  if (fields.type === 'HS256' && typeof fields.key === 'string' && fields.key.trim()) {
    return { algorithm: 'HS256', key: fields.key, kid };
  }
  if (fields.type === 'RS256' && typeof fields.signingKey === 'string') {
    try {
      const privateKey = createPrivateKey(fields.signingKey);
      const publicKey = typeof fields.key === 'string' && fields.key.trim()
        ? createPublicKey(fields.key) : createPublicKey(privateKey);
      if (privateKey.asymmetricKeyType !== 'rsa' || publicKey.asymmetricKeyType !== 'rsa') return null;
      if (createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }) !== publicKey.export({ type: 'spki', format: 'pem' })) return null;
      return { algorithm: 'RS256', privateKey, publicKey, kid };
    } catch { return null; }
  }
  return null;
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
