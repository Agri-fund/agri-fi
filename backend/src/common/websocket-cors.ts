/** CORS policy shared by WebSocket gateways and aligned with main.ts. */
export const websocketCorsOptions = {
  origin: (
    origin: string | undefined,
    callback: (error: Error | null, allow?: boolean) => void,
  ): void => {
    const allowedOrigins = (
      process.env.ALLOWED_ORIGINS ?? 'http://localhost:3000'
    )
      .split(',')
      .map((allowedOrigin) => allowedOrigin.trim())
      .filter((allowedOrigin) => allowedOrigin.length > 0);

    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error('Origin not allowed by CORS policy'));
  },
  credentials: true,
};
