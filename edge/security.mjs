// Cabeceras de seguridad comunes (Cloudflare y servidor de reserva).
export const security = {
 'X-Content-Type-Options':'nosniff',
 'Referrer-Policy':'same-origin',
 'X-Frame-Options':'DENY',
 'Permissions-Policy':'camera=(self), microphone=(self), geolocation=()',
 'Strict-Transport-Security':'max-age=15552000',
 'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self' wss:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
};
