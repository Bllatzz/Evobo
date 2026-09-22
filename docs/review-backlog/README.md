# Backlog da revisão de código (2026-09-21)

Tudo o que a revisão apontou e **não foi corrigido**: patches que você pulou, itens adiados e o que ainda
aguarda decisão. A revisão cobriu `apps/worker` + `apps/api` (bloco 1) e `apps/web` (bloco 2).

O que **já foi corrigido** está nos commits `6dcbbef` (RLS, túnel, dono/admin, migrations),
`0432818` (XSS de links) e `b972382` (RoleEditor). Este arquivo é atualizado conforme você pula ou adia mais coisas.

> Confiança: **✔** = confirmado lendo o código · **~** = plausível, não reproduzido.

---

## 1. Patches que você pulou (dá para retomar)

| # | O que é | Onde | Como retomar |
|---|---|---|---|
| 5 | ✔ **Importar apostas da casa**: se trocar o dropdown de casa depois de "Conferir", o "Gravar" grava as apostas conferidas na casa nova. Seu motivo: raro, pois exigiria trocar a casa de propósito. Obs.: o casamento é por odd e jogo (não por casa), então tips sem casa definida ainda casariam. | `apps/web/src/app/telegram-tips/ImportBookmakerBetsPage.tsx` | `git apply docs/review-backlog/patch-5-import-bookmaker.patch` |
| 7 | ✔ **Campos de unidade/odd/limite das Telegram tips**. *Admin*: ao sair do campo sempre manda PATCH, e texto vazio/inválido/`0` apaga o valor oficial da tip; o texto não ressincroniza depois de OCR/grading (pode gravar o valor velho por cima do novo). *Sua tela (Peguei)*: depois de salvar o campo continua com o que você digitou (ex.: `3`), mas o servidor guardou o valor limitado (`2`) — só visual, o limite da casa **já é aplicado pelo servidor**. Seu motivo: só você usa o admin e só ajusta a odd quando vem errada, então o risco é baixo. | `TelegramTipsPage.tsx` (~93-112, ~205-212, ~982), `admin/telegram-tips/AdminTelegramTipsPage.tsx` (~67, ~218-230, ~333-374) | Admin: comparar com o valor atual antes de gravar, reverter texto inválido, `useEffect` para ressincronizar. Sua tela: `useEffect` que atualiza `unitText`/`oddText` quando não há rascunho |
| 8 | ✔ **Perfil público do tipster** (`ProfilePage.tsx`). (1) O gráfico "EVOLUÇÃO DE LUCRO · 90 DIAS" plota **todas** as tips que a tela tem, não só as de 90 dias (o número "LUCRO 90D" ao lado filtra, e os dois podem discordar). (2) **O lucro de 90 dias, verdes/vermelhas e odd média de 30 dias vêm só das últimas 30 tips**, porque `GET /users/:username/tips` tem `take: 30` (`apps/api/src/modules/users/routes.ts`) — para um tipster com mais de 30 tips o número fica errado (ROI e acerto do topo vêm de outro cálculo e estão certos). (3) `toFixed(0)` mostra `-0u`/`+0u` para lucros pequenos. Seu motivo: a parte de tipster ainda não foi construída. | `apps/web/src/app/profile/ProfilePage.tsx` (~18-60, ~119-131, ~225-242) | Correção pequena: filtrar o gráfico pelos últimos 90 dias (`last90`) e usar 1 casa decimal. Correção de verdade do (2): a API calcular os totais de 30/90 dias no servidor |
| 10 | ✔ **`import-bets` (API)**: o upsert grava `bonusReais = null` por cima de um bônus digitado à mão; a prévia (dry-run) mostra `0` em vez de vazio quando a take não tem unidade; a tip "reivindicada" no ramo *divergente* continua na lista de candidatas e pode explicar uma 2ª aposta. ~ Rename/delete de casa em várias etapas, sem transação. | `apps/api/src/modules/telegram-tips/routes.ts` (~331-380, ~685-860) | Cada correção é 1 linha: manter o bônus se o novo for vazio; mostrar vazio na prévia; tirar a tip de `remaining` no ramo divergente |
| 22 | ✔ **Grading**: (a) grupos de emoji (Super Odds) aplicam ✅✅✅/❌❌❌ a **todas** as pernas pendentes de uma mensagem (só os grupos de marcador têm o guard `tipCount > 1`); (b) `flag()` do `runDailyGrading` não confere `result: "pending"`; (c) se o `runTippyGrading` falhar, o resultado do bet-analytix se perde. Provavelmente raro: as mensagens desses grupos parecem ter 1 tip. | `apps/worker/src/resultFromEmoji.ts` (~197), `apps/worker/src/betAnalytix/runDailyGrading.ts` | Aplicar o mesmo guard `tipCount > 1`; `updateMany` com `result: "pending"`; `try/catch` em volta do Tippy |
| 23 | ✔ **`resultAutoChecker` (robotip-legacy)**: o `UPDATE alerts SET result = ...` do checker automático (corners/home-win) não exige `result = 'pending'`, só o `id`. Se o resultado já foi decidido (Telegram ou ajuste manual) bem no instante em que o checker roda, ele sobrescreve. Janela de corrida estreita (milissegundos entre o SELECT e o UPDATE). | `packages/robotip-legacy/src/services/resultAutoChecker.js` (`checkAlert`, ~78-90) | `UPDATE ... WHERE id = $2 AND result = 'pending'`; logar quando `rowCount === 0` (resultado já decidido por outro caminho) |
| — | **ErrorBoundary** (o app inteiro fica em branco se uma tela lançar erro ao desenhar, ex.: `profile.roi.toFixed` com `roi` nulo, `perf.bestRun.length` sem operações). Só a tela 404 foi feita. | `apps/web/src/main.tsx` | Componente de captura mostrando "Algo deu errado" + botão Recarregar |

## 2. Ainda a decidir (patches de funcionalidade do `apps/web`)

- **✔ auth (`stores/auth.tsx`)**: falha transitória do `/auth/me` na 1ª carga te manda para `/login`; `getSession()` sem `catch`.
- **~ Formatação**: `formatOdds(null)` mostra `0.00`; `formatUnits` arredonda 0,25u para `0.3u`.

## 3. Adiados — bloco 1 (`worker` + `api`)

1. ✔ **ALTA — `/robotip` legado sem autenticação**: `DELETE /gestao/reset`, `POST/PATCH/DELETE` de alertas, bot-configs, `apply-odds`, com `cors()` aberto, montado na API pública. **Precisa da sua decisão** de como autenticar sem quebrar o frontend antigo (`robotip-analyzer.vercel.app`). `packages/robotip-legacy/index.js:29-36`, `apps/api/src/server.ts`.
2. **Rebuild/backfill destrutivo** síncrono no request (`backfillSince` apaga tips e faz cascade nos takes; `sinceUnix=0` varre tudo; sem lock/dry-run). Deliberado e só admin.
3. ✔ **bet-analytix lê só a 1ª página** (`waitForResponse` na 1ª resposta): bankroll grande perde bets antigas e as tips ficam pendentes. `playwrightFetch.ts:50`.
4. **Matching/LLM**: Jaccard 0,3; a mesma entrada pode explicar várias tips no caminho não-LLM; LLM com ~1,6% de erro medido (2/125). Ruído já conhecido (~0,6%).
5. **Ranking** sem amostra mínima, sem cache, incluindo `vip_only`.
6. ✔ **Testes**: só existe o do `neoia-scraper` (módulo morto). Nada para `parseTip`, matchers, matemática de banca, RLS, guards.
7. **Worker**: `groupByChatId` fixo no boot; `client.start` interativo trava na Fly; poll sem guarda de reentrância nem backoff de FloodWait; UUID de usuário fixo em `reactionTake.ts:11`.
8. **Infra**: dois `PrismaClient` no processo (medir antes — há custo/memória); filas BullMQ sem listener de `error`; Docker como root, `node:24-alpine` sem pin, sem HEALTHCHECK; `playwright` em runtime; `big-integer` não declarado; `tsconfig` inclui `scripts`.
9. **Schema**: sem `CHECK` em odds/stake/amount; faltam índices (`comments.tip_id`, `tips.vip_group_id`…); FKs `telegram→users` sem `ON DELETE`; `prisma migrate dev` sem shadow DB com `auth`/`storage`.
10. **RLS/VIP**: ramo VIP morto (`vip_subscriptions` com RLS e sem policy); `/me/bets` mantém tips VIP vencidas; listagem de tips limitada a 30 sem cursor. Só importa quando pagamentos/VIP existirem.
11. **Código morto**: `neoia-scraper`, rotas stub (`ai-analysis`, `notifications`, `payments`, `vip`), `socket.io`; EV+ dormente.
12. **Tippy/OCR**: `parseTippyCalls` sem guarda de elemento nulo; `discardReason` por texto exato; `visionProvider` cai em silêncio para Gemini com valor desconhecido.

Também não corrigidos (~): `parseTip` — `ODD_LINE_RE` sem âncora (um comentário pode sobrescrever a odd) e bookmaker extraído de subdomínio (`sports.bet365.com` → `sports`); caches de EV+/`teamForm` sem single-flight; o fetcher `:3939` escuta em todas as interfaces (não mudei por causa do histórico de `localhost` → `[::1]` no WSL2).

## 3b. Adiados — bloco 3 (`packages/robotip-legacy`, `scripts`, `infra`, `.github`, config da raiz)

Aplicados desta revisão: cliente do Telegram desconectado ao reconectar (watchdog), e alerta duplicado (mesmo bot, mesmo jogo, dentro de 30s) não dispara mais aposta automática duas vezes. `packages/robotip-legacy/src/services/telegram.js`.

**`packages/robotip-legacy` — HTTP (`routes/*.js`), tudo sem autenticação (ver item 1 acima, que já cobre isso em geral):**
1. `PATCH /api/bot-configs/:botName` **liga apostas automáticas de verdade** sem login; `POST /:botName/apply-odds` reescreve `bet_odds` de todo o histórico do bot em `alerts` **e** `gestao_banca`, sem transação, sem auditoria.
2. `POST /api/alerts` insere qualquer JSON do corpo (46 colunas) sem validar tipo/tamanho, e transmite via SSE pra todo mundo conectado.
3. `GET /api/alerts` e `/stats`: `limit`/`page` sem teto (`?limit=100000000` derruba a tabela); `bot_names` quebra com parâmetro repetido; datas inválidas dão 500.
4. `PATCH /api/alerts/:id` não é transacional com a sincronização do `gestao_banca`, e o upsert usa `EXCLUDED.stake_pct` (sempre não-nulo) — pode sobrescrever um stake ajustado por outro caminho (`PATCH /gestao/bot/:botName`).
5. `POST /api/gestao/sync` usa `NOT EXISTS` em vez de `ON CONFLICT DO NOTHING` — corrida com o PATCH de alerts ou com o caminho do Telegram gera erro 500 sem transação.
6. `queryCache` do `alerts.js` usa `req.originalUrl` cru como chave, sem teto — cresce sem limite com query strings diferentes.
7. `GET /events` (SSE): sem autenticação, sem heartbeat, sem limite de conexões — qualquer um recebe `raw_message` de todo alerta em tempo real.
8. `POST`/`PATCH` de `bot-filter-profiles`: `name.trim()` sem checar tipo (500 se não for string); `bot_names` nunca validado como array.

**`services/telegram.js` (Telegram/parsing) — não corrigidos nesta revisão:**
9. `claim(id)` marca a mensagem como processada **antes** de processar — se `processMessage` falhar (erro transitório de banco), a mensagem nunca mais é tentada de novo.
10. Se a leitura da linha de base (`baselineId`) falhar no boot, ela fica em `0` e o poll de 15s pode reprocessar as últimas 20 mensagens do canal, reaplicando resultados e podendo disparar apostas automáticas antigas de novo.
11. O watchdog de silêncio (10min sem update) não é atualizado só pelo poll bem-sucedido — pode forçar reconexões falsas em horário de pouco jogo, piorando a frequência do bug do item de conexão dupla (já corrigido no ponto de vazamento, mas a causa da reconexão em si continua).
12. `updateAlertResult`: usa `ILIKE '%...%'` sem escapar `%`/`_`/`\` do texto vindo do Telegram; `UPDATE ... WHERE id = (SELECT ... LIMIT 1)` sem `FOR UPDATE SKIP LOCKED` — push e poll concorrentes podem selecionar a mesma linha pendente.
13. O backfill dos últimos 7 dias de resultado (rodado a cada boot) não é idempotente — pode fechar um alerta pendente errado do mesmo jogo se a mensagem de resultado for reprocessada.
14. `parseResult`: testa `RED`/`GREEN`/`WON`/`LOST` em qualquer linha da mensagem, incluindo o nome dos times — um time chamado "Red Bull" ou "Red Star" pode ser lido como resultado vermelho.
15. `parseAlert` pode devolver `home_team`/`away_team` nulos quando o formato foge do esperado; a checagem de duplicata (`home_team = $2`) nunca casa com `NULL`, então esses alertas nunca são detectados como duplicata nem batem com uma mensagem de resultado depois.
16. `ROBOTIP_TELEGRAM_BOT_SOURCE` não definido: o listener aceita mensagens de **qualquer** chat, incluindo apostas automáticas disparadas por mensagem forjada.
17. A sessão do Telegram é salva em texto puro num `.env` local (só funciona em dev; na Fly o filesystem é efêmero) — login interativo em produção trava esperando `stdin`.
18. `dispararAutoAposta`: sem `ROBOTIP_BRIDGE_SECRET` configurado, a chamada pra ligar a aposta sai **sem segredo nenhum**; sem timeout no fetch.

**`services/cornerAutoChecker.js` / `homeWinAutoChecker.js`:**
19. `Number(null)` vira `0` — se a StatsFeed devolver campos nulos (jogo adiado/abandonado), o corner-checker pode gradar green/red errado em vez de esperar. Depende do comportamento real da API upstream (`ended=1`), não confirmado.
20. `resultAutoChecker.start()` sem guarda de reentrância — chamar duas vezes cria dois timers rodando em paralelo.

**Scrapers (`scripts/bookmaker-scrapers/*.js`) — extraem o histórico de apostas do seu próprio navegador, você que roda:**
21. Só bet365 e betano validam odd/stake antes de gerar o JSON; lottu/novibet/esportesdasorte podem gerar `NaN`, que o servidor rejeita no import inteiro (1 aposta ruim derruba o lote).
22. Betano: quando o resultado é "ganha" e o cálculo bate diferente do texto, o script **reescreve o stake** silenciosamente (sem aviso no console).
23. Bet365: a data da aposta é a primeira `dd/mm/yyyy` encontrada no card — pode pegar a data do jogo em vez da data da aposta.
24. Todos: paginação por clique em botão por texto (`/mostrar mais|carregar mais/i`), sem escopo — pode clicar em botão errado da página. Fuso horário fixo em `-03:00` independente do navegador.

**Config raiz / CI / infra:**
25. `.github/workflows/ci.yml`: sem bloco `permissions:` (token com escopo padrão de escrita); actions presas em `@v4` (tag móvel, não SHA); `node-version: 20`, já fora do suporte na data desta revisão.
26. `infra/docker-compose.yml`: Redis exposto em `0.0.0.0:6379` sem senha.
27. `.dockerignore`: só ignora `**/*.env` e `**/*.env.local` — `.env.production`/`.env.development` não estão cobertos.
28. `vercel.json`: sem headers de segurança (CSP, X-Frame-Options) no rewrite catch-all.
29. `db/pool.js` (robotip-legacy): `ssl: { rejectUnauthorized: false }` no Postgres, sem `pool.on('error')`.

**`packages/shared-types` — validação fraca, não corrigida:**
30. `odds`/`odd` só exige `positive()`, sem mínimo de 1.0 nem teto — `0.0001` passa.
31. `ImportBookmakerBetsInput.bets` sem `.max()` no array; o comentário diz que `dryRun` tem default `true`, mas o schema não tem `.default(true)` — depende de quem consome tratar `undefined` como dry-run.
32. `TipStatus` duplicado entre `packages/design-tokens` (union TS) e `packages/shared-types` (`z.enum`) — risco de os dois saírem de sincronia.

## 4. Adiados — bloco 2 (`apps/web`)

1. **Sem CSP**, token do Supabase no `localStorage` (padrão do supabase-js) e `@import` do Google Fonts (LGPD, bloqueia render). `index.html`, `src/index.css`, `src/lib/supabase.ts`. Amplia o peso de qualquer XSS futuro.
2. ✔ **~15 telas sem `.catch`** → "Carregando…" para sempre ou rejeição sem tratamento: AdminPage, AdminRolesPage, AdminScreensPage, AdminUsersPage, AdminTelegramTipsPage, EvPage, FeedPage, LivePage, MyProfilePage, NewTipPage, MarketsPage, MarketChartPage, RankingPage, SearchPage, TelegramReportPage, TelegramTipsPage, DesktopFeedRail, DesktopSidebar.
3. **Respostas fora de ordem**: buscas, filtros e polling sem `AbortController`/flag de cancelamento.
4. ✔ **Teto de 60 tips** sem paginação em `TelegramTipsPage.tsx:896` (`limit: 60`).
5. **Acessibilidade**: `Modal` sem `role="dialog"`/foco; `Dropdown`/`BookmakerCombobox` sem teclado/ARIA; contraste do tema claro; `Toggle` e `PaginationControl` sem `type="button"`.
6. **Botões/abas sem função**: "Compartilhar" (perfil), "Seguindo" (feed, igual a "Para você"), chip "Esportes" (busca), "Basquete"/"Favoritos" (ao vivo), "+ Adc na gestão" (EV+), "Assinar VIP".
7. **Árvores mobile e desktop renderizadas juntas** (estado e requisições em dobro) em várias páginas.
8. **Reset de senha**: a detecção por hash / evento `PASSWORD_RECOVERY` pode falhar em link PKCE (`?code=`). `ResetPasswordPage.tsx`.
9. **Avatar**: aceita qualquer URL (rastreamento) e a extensão vem do nome do arquivo, sem limite de tamanho/tipo no cliente. `lib/profile.ts`.
10. **CSV do relatório**: injeção de fórmula (nomes começando com `=`, `+`, `-`, `@`) e separador `,` (Excel pt-BR espera `;`). `TelegramReportPage.tsx`.
11. ✔ **Zero testes no web** (`"test": "echo no tests yet"`); lint com poucas regras (oxlint só com `rules-of-hooks` e `only-export-components`).
12. Sem code-splitting: todas as páginas, inclusive as de admin, entram no bundle inicial.
15. ✔ **Ranking (`RankingPage.tsx`)** — só as cores foram corrigidas (ROI negativo agora é vermelho). O resto ficou para quando você construir a parte de tipster: (a) o pódio e a lista mostram **sempre o ROI**, mesmo com o filtro "Assertividade" ou "Seguidores" ativo, então não dá para ver o critério pelo qual ordenou; (b) o chip **"Futebol"** é a mesma lista do ROI (o próprio comentário admite que ainda não há outro esporte para excluir); (c) **"Seguidores"** reordena no navegador uma lista que veio da API ordenada por ROI — se a API limitar/filtrar essa lista (mínimo de tips, top N), não é o ranking real de seguidores; (d) `toFixed(0)` pode mostrar `-0%`; (e) a busca do ranking não tem `catch` nem cancelamento (respostas fora de ordem mostram dados de outro filtro).
14. **`viewport-fit=cover`** em `apps/web/index.html`: sem ele, `env(safe-area-inset-bottom)` (usado na `TabBar`) vale 0 no iPhone com notch. Não apliquei porque muda o layout e só dá para validar num iPhone real.
13. ✔ **Meu Perfil (`MyProfilePage.tsx`)**: se **uma** das 4 consultas da abertura da página falhar (`Promise.all` de settings, saldos, banca e nomes de casa — até `fetchBookmakerNames`), a área inteira do Telegram zera sem aviso. Correção: `Promise.allSettled` e mostrar o que carregou.

## 5. Ideias de funcionalidade (suas)

### Unidade histórica — o passado guarda a unidade do passado

> "Se minha unidade hoje é 20, mas eu tripliquei a banca e agora quero apostar 40 por unidade, o que está no
> passado fica salvo como 20. As futuras serão 40."

**Como é hoje:** existe **um único** valor por usuário (`telegram_banca_settings.unit_value`) e ele é aplicado a
**todo** o histórico. Mudar de 20 para 40 reescreve retroativamente os valores em reais das apostas passadas.
Onde isso acontece:
- `apps/api/src/modules/telegram-tips/routes.ts`: `aggregateBy` (`stakedBRL`/`profitBRL`), `series` (bônus em R$ → unidades),
  `applyStakeLimit` (limite em R$ ÷ unidade), `/import-bets` (unidade implícita e tolerância).
- `apps/web/src/app/profile-me/MyProfilePage.tsx`: `brl(stats.bancaInicial * stats.unitValue)` e a banca inicial
  (`depósitos ÷ unidade`).

**Esboço:** tabela `telegram_unit_value_history (user_id, unit_value, effective_from)` e uma função
`unitValueAt(data)` no lugar do valor único. Editar o "valor da unidade" passa a criar um período novo
("a partir de hoje") em vez de sobrescrever. Cada aposta é convertida com a unidade vigente na data dela.

**Perguntas em aberto:** (1) o gráfico e a banca ficam em unidades ou em R$? (unidades por aposta não mudam, só a
conversão para R$); (2) como tratar os depósitos, que são em R$ — a "banca inicial em unidades" depende de qual
unidade?; (3) o limite da casa (`limite ÷ unidade`) deve usar a unidade da data da tip.

## 6. Ações manuais pendentes

- **`TUNNEL_SECRET`**: a senha do túnel só vale depois de definir o **mesmo valor** na Fly (secret) e no `.env` do PC, **nessa ordem** (worker primeiro, proxy depois).
- **Build da Vercel e CI do GitHub**: não consegui verificar (`gh` não está instalado). Vale conferir os commits `0432818` e `b972382`.
- **Tema claro** da tela 404: não foi testado.
- **`apps/betting-extension/`**: pasta sua, ainda sem commit — não foi tocada pela revisão.
