export function getBackendUrl(): string {
  const url = process.env.BACKEND_URL;

  if (!url && process.env.NODE_ENV === 'production') {
    throw new Error(
      'BACKEND_URL environment variable is required in production. ' +
      'Please set BACKEND_URL to your backend API endpoint.'
    );
  }

  return url || 'http://localhost:3001';
}

// Named export for direct use in API route files
export const BACKEND_URL = getBackendUrl();

const API_VERSION = '/v1';

export async function fetchBackend(
  path: string,
  options?: RequestInit
): Promise<Response> {
  const backendUrl = getBackendUrl();
  const versionedPath = path.startsWith('/v1') || path.startsWith('/v2')
    ? path
    : `${API_VERSION}${path}`;
  const url = `${backendUrl}${versionedPath}`;

  try {
    const response = await fetch(url, options);
    return response;
  } catch (error) {
    throw {
      isBackendUnreachable: true,
      originalError: error,
    };
  }
}
