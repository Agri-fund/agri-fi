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

export async function fetchBackend(
  path: string,
  options?: RequestInit
): Promise<Response> {
  const backendUrl = getBackendUrl();
  const url = `${backendUrl}${path}`;

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
