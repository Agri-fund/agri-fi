import {
  authHeader,
  clearAuthToken,
  getAuthToken,
  legacyTokenKeys,
  setAuthToken,
  tokenKey,
} from '../auth-token';
import { apiClient, getStoredToken } from '../api';

describe('auth-token helper', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('uses auth_token as the canonical key', () => {
    expect(tokenKey).toBe('auth_token');
  });

  it('returns null when no token is stored', () => {
    expect(getAuthToken()).toBeNull();
    expect(authHeader()).toEqual({});
  });

  it('writes and reads the token under the canonical key', () => {
    setAuthToken('jwt-123');
    expect(localStorage.getItem(tokenKey)).toBe('jwt-123');
    expect(getAuthToken()).toBe('jwt-123');
    expect(authHeader()).toEqual({ Authorization: 'Bearer jwt-123' });
  });

  it('clears canonical and legacy keys from both storages', () => {
    setAuthToken('jwt-123');
    localStorage.setItem('authToken', 'old');
    sessionStorage.setItem(tokenKey, 'session-copy');
    sessionStorage.setItem('token', 'old-session');

    clearAuthToken();

    expect(getAuthToken()).toBeNull();
    expect(localStorage.getItem(tokenKey)).toBeNull();
    expect(localStorage.getItem('authToken')).toBeNull();
    expect(sessionStorage.getItem(tokenKey)).toBeNull();
    expect(sessionStorage.getItem('token')).toBeNull();
  });

  it.each(legacyTokenKeys)(
    'migrates a token stored under the legacy "%s" key',
    (legacyKey) => {
      localStorage.setItem(legacyKey, 'legacy-jwt');

      expect(getAuthToken()).toBe('legacy-jwt');
      expect(localStorage.getItem(tokenKey)).toBe('legacy-jwt');
      expect(localStorage.getItem(legacyKey)).toBeNull();
    },
  );

  it('prefers the canonical key over legacy keys', () => {
    localStorage.setItem('authToken', 'stale');
    setAuthToken('fresh');
    localStorage.setItem('token', 'also-stale');
    expect(getAuthToken()).toBe('fresh');
  });

  it('setAuthToken removes stale legacy copies', () => {
    localStorage.setItem('authToken', 'stale');
    setAuthToken('fresh');
    expect(localStorage.getItem('authToken')).toBeNull();
  });

  describe('cross-surface consistency with apiClient', () => {
    const user = { id: 'u1', email: 'a@b.c' } as any;

    it('a token set via apiClient is visible to getAuthToken', () => {
      apiClient.setAuth('from-api-client', user);
      expect(getAuthToken()).toBe('from-api-client');
      expect(getStoredToken()).toBe('from-api-client');
    });

    it('a token set via setAuthToken is used by apiClient', () => {
      setAuthToken('from-helper');
      expect(getStoredToken()).toBe('from-helper');
    });

    it('apiClient.clearAuth clears the token for every surface', () => {
      setAuthToken('to-clear');
      localStorage.setItem('authToken', 'legacy');
      apiClient.clearAuth();
      expect(getAuthToken()).toBeNull();
    });
  });
});
