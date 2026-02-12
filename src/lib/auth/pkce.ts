export type PkceChallengeMethod = 'S256' | 'plain';

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const value of bytes) {
    binary += String.fromCharCode(value);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function getRandomBytes(size: number): Uint8Array {
  const data = new Uint8Array(size);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(data);
    return data;
  }
  for (let i = 0; i < size; i += 1) {
    data[i] = Math.floor(Math.random() * 256);
  }
  return data;
}

export function randomBase64Url(bytes = 32): string {
  return encodeBase64Url(getRandomBytes(bytes));
}

export async function createPkceChallenge(
  verifier: string,
): Promise<{ challenge: string; method: PkceChallengeMethod }> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle?.digest) {
    return { challenge: verifier, method: 'plain' };
  }
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { challenge: encodeBase64Url(new Uint8Array(digest)), method: 'S256' };
}

