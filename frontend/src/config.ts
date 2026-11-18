// Backend location. Set VITE_BACKEND_URL at build time (e.g. https://pen-fight-backend.onrender.com).
// Falls back to the local dev server.
const raw = (import.meta.env.VITE_BACKEND_URL as string | undefined)?.trim().replace(/\/+$/, '');

export const BACKEND_HTTP_URL = raw
  ? raw.replace(/^ws(s?):\/\//, 'http$1://')
  : 'http://localhost:8000';

export const BACKEND_WS_URL = BACKEND_HTTP_URL.replace(/^http(s?):\/\//, 'ws$1://');

/**
 * Free hosting tiers sleep when idle. Ping the backend early (e.g. on the lobby screen)
 * so it is awake by the time a multiplayer room is created. Errors are ignored.
 */
export const wakeBackend = () => {
  fetch(`${BACKEND_HTTP_URL}/`, { mode: 'cors' }).catch(() => {});
};
