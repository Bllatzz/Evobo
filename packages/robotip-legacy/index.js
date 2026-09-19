'use strict';

// Backend do CornerIQ (robotip-analyzer), portado do app Fly separado pra
// rodar dentro do processo do evobo-api. Mantém a lógica original intacta —
// só perde o app.listen() próprio (o evobo monta o app Express via
// @fastify/express) e os nomes das env vars ganham o prefixo ROBOTIP_ pra
// não colidir com os do evobo/evobo-worker (ver server.ts).

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

function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get('/health', (req, res) => res.json({ ok: true }));

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
