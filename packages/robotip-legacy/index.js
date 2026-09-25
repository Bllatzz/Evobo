'use strict';

// Backend do CornerIQ (robotip-analyzer), portado do app Fly separado pra
// rodar dentro do processo do evobo-api. Mantém a lógica original intacta —
// só perde o app.listen() próprio (o evobo monta o app Express via
// @fastify/express) e os nomes das env vars ganham o prefixo ROBOTIP_ pra
// não colidir com os do evobo/evobo-worker (ver server.ts).

const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const alertsRouter            = require('./src/routes/alerts');
const gestaoRouter            = require('./src/routes/gestao');
const botConfigsRouter        = require('./src/routes/botConfigs');
const botFilterProfilesRouter = require('./src/routes/botFilterProfiles');
const gestaoSettingsRouter    = require('./src/routes/gestaoSettings');
const { startTelegramListener: connectTelegramOnce } = require('./src/services/telegram');
const { startCornerAutoChecker } = require('./src/services/cornerAutoChecker');
const { startHomeWinAutoChecker } = require('./src/services/homeWinAutoChecker');

// Evita que erros não tratados aqui derrubem o processo do evobo-api inteiro
// (mesmo comportamento de proteção que o robotip-analyzer original tinha).
process.on('uncaughtException', (err) => {
  console.error(`[robotip-legacy] [${new Date().toISOString()}] uncaughtException:`, err);
});
process.on('unhandledRejection', (reason) => {
  console.error(`[robotip-legacy] [${new Date().toISOString()}] unhandledRejection:`, reason);
});

// Compara via SHA-256 dos dois lados: timingSafeEqual exige buffers do mesmo
// tamanho, e o hash evita vazar o tamanho da chave pelo tempo de resposta.
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// Estas rotas leem, editam e apagam todo o histórico de apostas (inclusive
// DELETE /api/gestao/reset) e não têm outra camada de auth — o CORS do
// Fastify só barra navegador, não curl. Falha fechado: sem ROBOTIP_API_KEY
// configurada responde 503 em vez de ficar aberto (sem derrubar o evobo-api
// inteiro, que é o mesmo processo). EventSource não manda header custom,
// então /api/alerts/events aceita a chave por querystring (?api_key=) —
// server.ts tira esse parâmetro do log.
function requireApiKey(req, res, next) {
  const expected = process.env.ROBOTIP_API_KEY;
  if (!expected) {
    return res.status(503).json({ error: 'robotip_api_key_not_configured' });
  }
  const provided = req.headers['x-api-key'] || req.query.api_key;
  if (typeof provided !== 'string' || !safeEqual(provided, expected)) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get('/health', (req, res) => res.json({ ok: true }));

  app.use('/api', requireApiKey);

  app.use('/api/alerts', alertsRouter);
  app.use('/api/gestao', gestaoRouter);
  app.use('/api/bot-configs', botConfigsRouter);
  app.use('/api/bot-filter-profiles', botFilterProfilesRouter);
  app.use('/api/gestao-settings', gestaoSettingsRouter);

  return app;
}

// Loop de reconexão do listener do Telegram — idêntico ao que index.js do
// robotip-analyzer fazia no boot, incluindo o tratamento especial de
// AUTH_KEY_DUPLICATED (outra instância usando a mesma sessão).
async function startTelegramListener() {
  while (true) {
    try {
      console.log(`[robotip-legacy] [${new Date().toISOString()}] Iniciando listener do Telegram...`);
      await connectTelegramOnce();
    } catch (err) {
      console.error(`[robotip-legacy] [${new Date().toISOString()}] Listener caiu:`, err.message);

      if (err.message && err.message.includes('AUTH_KEY_DUPLICATED')) {
        console.error(`[robotip-legacy] [${new Date().toISOString()}] AUTH_KEY_DUPLICATED: outra instância está usando a mesma sessão.`);
        console.error(`[robotip-legacy] [${new Date().toISOString()}] Aguardando 10 minutos antes de tentar novamente...`);
        await new Promise(r => setTimeout(r, 10 * 60_000));
      } else {
        console.log(`[robotip-legacy] [${new Date().toISOString()}] Reconectando em 15s...`);
        await new Promise(r => setTimeout(r, 15_000));
      }
    }
  }
}

module.exports = {
  createApp,
  startTelegramListener,
  startCornerAutoChecker,
  startHomeWinAutoChecker,
};
