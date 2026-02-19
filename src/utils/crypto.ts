import { v4 as uuidv4 } from 'uuid';

export function generateId(): string {
  return uuidv4();
}

export function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function generateViewToken(): string {
  return uuidv4();
}

/** AES-256-GCM encrypt. Returns base64url-encoded "iv:ciphertext:tag" */
export async function encryptFlash(plaintext: string, secret: string): Promise<string> {
  const key = await importKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const cipherBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  const combined = new Uint8Array(iv.byteLength + cipherBuf.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(cipherBuf), iv.byteLength);
  return Buffer.from(combined).toString('base64url');
}

/** AES-256-GCM decrypt. Returns plaintext or null on failure */
export async function decryptFlash(data: string, secret: string): Promise<string | null> {
  try {
    const key = await importKey(secret);
    const combined = Buffer.from(data, 'base64url');
    const iv = combined.subarray(0, 12);
    const cipherBuf = combined.subarray(12);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipherBuf);
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}

async function importKey(secret: string): Promise<CryptoKey> {
  // Derive a 32-byte key from the hex secret
  const raw = Buffer.from(secret.padEnd(64, '0').slice(0, 64), 'hex');
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}
