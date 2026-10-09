'use strict';

// Cliente da API interna do robotip.com.br (a mesma que o site usa). Só lê,
// exceto createReport (gera um backtest — gasta 1 dos 10 slots da conta) e
// createBot (cria o robô otimizado, quando o operador pede no Laboratório).
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

async function request(path, init = {}) {
  if (!isConfigured()) throw new Error('ROBOTIP_EMAIL/ROBOTIP_PASSWORD não configurados');
  await ensureLogin();
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(`${BASE_URL}${path}`, {
      ...init,
      redirect: 'manual',
      headers: { ...init.headers, Cookie: sessionCookie },
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

const getJson = (path) => request(path);

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

/**
 * Gera um relatório de backtest — o mesmo POST multipart do modal "Gerar
 * relatório" do site. O site não devolve o id; o relatório aparece em
 * /api/reports com o `name` enviado.
 */
async function createReport({ name, market, filter, termex = '', isLive = true }) {
  const form = new FormData();
  form.set('name', name);
  form.set('isLive', String(Boolean(isLive)));
  form.set('market', market);
  form.set('filter', filter);
  form.set('termex', termex);
  form.set('betting_provider', '');
  form.set('lay_bet', 'false');
  const data = await request('/api/reports', { method: 'POST', body: form });
  if (!data || !data.success) throw new Error(`Robotip recusou o relatório: ${data?.error || JSON.stringify(data)}`);
  return data;
}

/**
 * Cria um robô — o mesmo POST JSON que o construtor de robôs do site faz ao
 * salvar uma cópia (`bot_ids: [-1]`). O site não devolve o id; o robô aparece
 * em /api/filter_live com o `filter_name` enviado.
 */
async function createBot(fields) {
  const data = await request('/api/filter_live', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...fields, bot_ids: [-1] }),
  });
  if (!data || !data.success || data.failed) {
    throw new Error(`Robotip recusou o robô: ${data?.message || data?.error || JSON.stringify(data)}`);
  }
  return data;
}

module.exports = { isConfigured, fetchBots, fetchReports, fetchReportDetail, createReport, createBot };
