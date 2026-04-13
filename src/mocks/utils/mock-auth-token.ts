export type MockAuthActor = {
  userId: string;
  userEmail: string | null;
};

const MOCK_TOKEN_PREFIX = 'mock_token_';

export function createMockAuthToken(args: {
  userId: string;
  userEmail?: string | null;
  issuedAt?: number;
}): string {
  const userId = args.userId.trim();
  const userEmail = args.userEmail?.trim().toLowerCase() ?? null;
  const issuedAt = typeof args.issuedAt === 'number' ? args.issuedAt : Date.now();
  if (!userId) {
    return `${MOCK_TOKEN_PREFIX}user_001_${issuedAt}`;
  }
  if (userEmail) {
    return `${MOCK_TOKEN_PREFIX}${userId}__${encodeURIComponent(userEmail)}__${issuedAt}`;
  }
  return `${MOCK_TOKEN_PREFIX}${userId}_${issuedAt}`;
}

export function parseMockAuthToken(token: string): MockAuthActor | null {
  const trimmed = token.trim();
  if (!trimmed.startsWith(MOCK_TOKEN_PREFIX)) return null;
  const rest = trimmed.slice(MOCK_TOKEN_PREFIX.length);
  const structuredParts = rest.split('__');
  if (structuredParts.length >= 3) {
    const [userId, encodedEmail] = structuredParts;
    if (!userId.trim()) return null;
    const userEmail = encodedEmail.trim().length > 0 ? decodeURIComponent(encodedEmail) : null;
    return { userId, userEmail };
  }
  const separator = rest.lastIndexOf('_');
  if (separator <= 0) return null;
  return {
    userId: rest.slice(0, separator),
    userEmail: null,
  };
}

export function readMockAuthActorFromRequest(request: Request): MockAuthActor {
  const authHeader = request.headers.get('authorization') ?? request.headers.get('Authorization');
  if (!authHeader) {
    return { userId: 'user_001', userEmail: null };
  }
  const token = authHeader.replace(/^Bearer\s+/i, '');
  return parseMockAuthToken(token) ?? { userId: 'user_001', userEmail: null };
}
