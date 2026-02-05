import { describe, it, expect } from 'vitest';
import { validateWorkspaceParam, validateProjectParam } from '../validate-url-params';

describe('validate-url-params', () => {
  describe('validateWorkspaceParam', () => {
    it('should accept valid workspace ID (UUID format)', () => {
      const result = validateWorkspaceParam('550e8400-e29b-41d4-a716-446655440000');
      expect(result).toBe('550e8400-e29b-41d4-a716-446655440000');
    });

    it('should accept valid workspace ID (string format)', () => {
      const result = validateWorkspaceParam('workspace-123');
      expect(result).toBe('workspace-123');
    });

    it('should reject empty string', () => {
      const result = validateWorkspaceParam('');
      expect(result).toBeUndefined();
    });

    it('should reject null', () => {
      const result = validateWorkspaceParam(null);
      expect(result).toBeUndefined();
    });

    it('should reject undefined', () => {
      const result = validateWorkspaceParam(undefined);
      expect(result).toBeUndefined();
    });

    it('should reject string with suspicious characters (XSS attempt)', () => {
      const result = validateWorkspaceParam('<script>alert("xss")</script>');
      expect(result).toBeUndefined();
    });

    it('should reject string with SQL injection attempt', () => {
      const result = validateWorkspaceParam("'; DROP TABLE users; --");
      expect(result).toBeUndefined();
    });
  });

  describe('validateProjectParam', () => {
    it('should accept valid project ID (UUID format)', () => {
      const result = validateProjectParam('550e8400-e29b-41d4-a716-446655440000');
      expect(result).toBe('550e8400-e29b-41d4-a716-446655440000');
    });

    it('should accept valid project ID (string format)', () => {
      const result = validateProjectParam('project-456');
      expect(result).toBe('project-456');
    });

    it('should reject empty string', () => {
      const result = validateProjectParam('');
      expect(result).toBeUndefined();
    });

    it('should reject null', () => {
      const result = validateProjectParam(null);
      expect(result).toBeUndefined();
    });
  });
});
