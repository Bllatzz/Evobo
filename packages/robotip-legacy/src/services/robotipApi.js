'use strict';

// Cliente read-only da API interna do robotip.com.br (a mesma que o site usa).
// Login é um POST de formulário em /api/login que devolve o cookie `session`
// (vale ~7 dias). Guarda o cookie em memória e refaz o login sozinho quando a
// sessão cai (401/403 ou redirect pro login).

const BASE_URL = 'https://robotip.com.br';
const TIMEOUT_MS = 60_000;

let sessionCookie = null;
let loginPromise = null;

function isConfigured() {
  return Boolean(process.env.ROBOTIP_EMAIL && process.env.ROBOTIP_PASSWORD);
}

async function login() {
  const res = await fetch(`${BASE_URL}/api/login`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      email: process.env.ROBOTIP_EMAIL,
      password: process.env.ROBOTIP_PASSWORD,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .find((c) => c.startsWith('session='));
  if (!cookie) throw new Error(`robotip login falhou (status ${res.status}, sem cookie de sessão)`);
  sessionCookie = cookie;
}

// Evita vários logins simultâneos quando requests paralelos tomam 401 juntos.
function ensureLogin(force = false) {
  if (sessionCookie && !force) return Promise.resolve();
  if (!loginPromise) loginPromise = login().finally(() => { loginPromise = null; });
  return loginPromise;
}

async function getJson(path) {
  if (!isConfigured()) throw new Error('ROBOTIP_EMAIL/ROBOTIP_PASSWORD não configurados');
  await ensureLogin();
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(`${BASE_URL}${path}`, {
      redirect: 'manual',
      headers: { Cookie: sessionCookie },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const loggedOut = res.status === 401 || res.status === 403 || (res.status >= 300 && res.status < 400);
    if (loggedOut && attempt === 0) {
      await ensureLogin(true);
      continue;
    }
    if (!res.ok) throw new Error(`robotip ${path} respondeu ${res.status}`);
    return res.json();
  }
  throw new Error(`robotip ${path}: sessão recusada mesmo após novo login`);
}

async function fetchBots() {
  const data = await getJson('/api/filter_live');
  return Array.isArray(data.lista) ? data.lista : [];
}

async function fetchReports() {
  const data = await getJson('/api/reports');
  return Array.isArray(data) ? data : [];
}

async function fetchReportDetail(id) {
  const data = await getJson(`/api/reports?id=${encodeURIComponent(id)}`);
  return Array.isArray(data) ? data[0] ?? null : data;
}

module.exports = { isConfigured, fetchBots, fetchReports, fetchReportDetail };
