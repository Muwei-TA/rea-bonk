export function runtimeConfig(env = process.env) {
  const port = Number(env.PORT || 3210);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT must be 1024..65535');
  const origins = [`http://127.0.0.1:${port}`, `http://localhost:${port}`];
  if (env.PUBLIC_ORIGIN) {
    const url = new URL(env.PUBLIC_ORIGIN);
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== env.PUBLIC_ORIGIN || url.username || url.password) {
      throw new Error('PUBLIC_ORIGIN must be a canonical HTTP(S) origin');
    }
    origins.push(url.origin);
  }
  return { port, host: env.HOST || '127.0.0.1', allowedOrigin: origin => !origin || origins.includes(origin) };
}
