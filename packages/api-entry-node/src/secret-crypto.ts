import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;

function getSecretKeyMaterial(): string {
  return process.env.USER_EXTERNAL_CONNECTIONS_SECRET_KEY?.trim()
    || process.env.AGENTSMITH_SECRET_KEY?.trim()
    || 'agentsmith-dev-user-external-connections-secret-key';
}

function deriveKey(): Buffer {
  return createHash('sha256').update(getSecretKeyMaterial()).digest();
}

export function encryptSecretValue(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, deriveKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return `enc:v1:${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
}

export function decryptSecretValue(ciphertext: string): string {
  if (!ciphertext.startsWith('enc:v1:')) {
    return ciphertext;
  }
  const [, , ivB64, authTagB64, encryptedB64] = ciphertext.split(':');
  if (!ivB64 || !authTagB64 || !encryptedB64) {
    throw new Error('invalid_encrypted_secret_payload');
  }
  const decipher = createDecipheriv(ALGO, deriveKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(authTagB64, 'base64'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedB64, 'base64')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

export function isEncryptedSecretValue(value: string): boolean {
  return value.startsWith('enc:v1:');
}
