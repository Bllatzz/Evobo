import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import {
  CreateTelegramGroupInput,
  UpdateTelegramGroupInput,
  UpdateTelegramTipInput,
  UpdateTelegramTipTakeInput,
  CreateManualTelegramTipInput,
  UpdateTelegramBancaSettingsInput,
  UpdateTelegramBookmakerBalancesInput,
  CreateTelegramBookmakerWithdrawalInput,
  ImportBookmakerBetsInput,
  type TelegramTip,
  type TelegramBancaRow,
  type TelegramBancaSettings,
  type TelegramBookmakerBalance,
  type TelegramBookmakerWithdrawal,
  type ImportBookmakerBetsResult,
} from "@evobo/shared-types";
import { matchBookmakerBet, type CandidateTip, ODD_TOLERANCE, textSimilarity, GAME_SIMILARITY_THRESHOLD } from "@evobo/worker";
import { authGuard } from "../../middleware/authGuard.js";
import { roleGuard } from "../../middleware/roleGuard.js";
import { randomUUID } from "node:crypto";
import { prisma } from "../../db/prisma.js";
import { supabaseAdmin } from "../../db/supabase.js";

/**
 * Bet-slip photos for the Banca Telegram tracker (apps/worker downloads them
 * off Telegram and uploads here). Created lazily on first use instead of via
 * a Supabase CLI migration — this project's migrations only manage Postgres
 * schema through Prisma, storage buckets aren't part of that flow yet.
 */
const PHOTO_BUCKET = "telegram-tip-photos";
const SIGNED_URL_TTL_SECONDS = 60 * 60;

let bucketReady: Promise<void> | null = null;
function ensurePhotoBucket(): Promise<void> {
  if (!bucketReady) {
    bucketReady = supabaseAdmin.storage.createBucket(PHOTO_BUCKET, { public: false }).then(
      () => undefined,
      (err) => {
        // "already exists" is the expected steady state — anything else is
        // worth knowing about, but must never block the module from loading.
        if (!String(err?.message).match(/already exists/i)) {
          console.error("[telegram-tips] failed to ensure photo bucket:", err);
        }
      },
    );
  }
  return bucketReady;
}

/** Tipo real da imagem pelos primeiros bytes — nunca confia no que o cliente diz. */
function detectImageType(buffer: Buffer): { contentType: string; ext: string } | null {
  if (buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { contentType: "image/jpeg", ext: "jpg" };
  if (buffer.length > 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { contentType: "image/png", ext: "png" };
  }
  if (buffer.length > 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") {
    return { contentType: "image/webp", ext: "webp" };
  }
  return null;
}

const MANUAL_PHOTO_MAX_BYTES = 5 * 1024 * 1024;
const MANUAL_GROUP_CHAT_PREFIX = "manual:";

/** Foto enviada pelo Admin (base64) → Storage. Devolve o path ou o código de
 * erro pra resposta — o tipo vem dos bytes, nunca do que o cliente diz. */
async function uploadAdminPhoto(
  base64: string,
  groupId: string,
): Promise<{ path: string } | { error: "photo_too_large" | "invalid_photo" | "photo_upload_failed"; status: number }> {
  const buffer = Buffer.from(base64, "base64");
  if (buffer.length > MANUAL_PHOTO_MAX_BYTES) return { error: "photo_too_large", status: 413 };
  const type = detectImageType(buffer);
  if (!type) return { error: "invalid_photo", status: 400 };
  await ensurePhotoBucket();
  const path = `${groupId}/manual-${randomUUID()}.${type.ext}`;
  const { error } = await supabaseAdmin.storage.from(PHOTO_BUCKET).upload(path, buffer, { contentType: type.contentType });
  if (error) {
    console.error("[telegram-tips] admin photo upload failed:", error);
    return { error: "photo_upload_failed", status: 502 };
  }
  return { path };
}

/** OCR só pro que ficou em branco; falha aqui nunca desfaz a gravação. */
async function enqueueOcrIfMissing(tip: { id: string; photoPath: string | null; odd: unknown; match: string | null; selection: string | null }) {
  if (!tip.photoPath || (tip.odd !== null && tip.match && tip.selection)) return;
  try {
    const { enqueueTipOcr } = await import("@evobo/worker");
    await enqueueTipOcr({
      id: tip.id,
      photoPath: tip.photoPath,
      needMarket: !tip.selection,
      needGame: !tip.match,
      needOdd: tip.odd === null,
    });
  } catch (err) {
    console.error("[telegram-tips] OCR enqueue failed:", err);
  }
}

/** Batch-resolves storage paths to signed URLs, preserving null slots for tips without a photo. */
async function resolvePhotoUrls(paths: (string | null)[]): Promise<Map<string, string>> {
  const distinct = [...new Set(paths.filter((p): p is string => p !== null))];
  if (distinct.length === 0) return new Map();

  const { data, error } = await supabaseAdmin.storage
    .from(PHOTO_BUCKET)
    .createSignedUrls(distinct, SIGNED_URL_TTL_SECONDS);
  if (error || !data) {
    console.error("[telegram-tips] failed to sign photo URLs:", error);
    return new Map();
  }

  const map = new Map<string, string>();
  for (const row of data) {
    if (row.signedUrl && !row.error) map.set(row.path ?? "", row.signedUrl);
  }
  return map;
}

type TipWithGroup = Prisma.TelegramTipGetPayload<{ include: { group: { select: { name: true } } } }>;
type TipTakeRow = Prisma.TelegramTipTakeGetPayload<{
  select: { takenStatus: true; unit: true; odd: true; bookmaker: true; betUrl: true; limitApplied: true };
}>;

/** Batch-fetches the current user's own TelegramTipTake for each tip id,
 * keyed by tipId — a tip with no row yet just isn't in the map (serializeTip
 * defaults it to pending/nulls). Same batching shape as resolvePhotoUrls. */
async function fetchMyTakes(tipIds: string[], userId: string): Promise<Map<string, TipTakeRow>> {
  if (tipIds.length === 0) return new Map();
  const rows = await prisma.telegramTipTake.findMany({
    where: { tipId: { in: tipIds }, userId },
    select: { tipId: true, takenStatus: true, unit: true, odd: true, bookmaker: true, betUrl: true, limitApplied: true },
  });
  return new Map(rows.map((r) => [r.tipId, r]));
}

/** Se a tip tem um `limit` (R$) registrado e a unidade pedida, convertida em
 * reais pelo unitValue (R$/u) da Banca deste usuário, passa desse limite, a
 * unidade EFETIVA gravada vira limite ÷ unitValue — nunca desqualifica a
 * aposta, só ajusta o número pro que a casa de fato deixou entrar. Sem
 * `limit` na tip ou sem unitValue configurado, não há como comparar (reais
 * contra uma unidade abstrata): devolve a unidade como pedida, sem marcar. */
async function applyStakeLimit(tipId: string, userId: string, requestedUnit: number): Promise<{ unit: number; limitApplied: boolean }> {
  const [tip, settings] = await Promise.all([
    prisma.telegramTip.findUnique({ where: { id: tipId }, select: { limit: true } }),
    prisma.telegramBancaSettings.findUnique({ where: { userId }, select: { unitValue: true } }),
  ]);
  const limitRs = tip?.limit != null ? Number(tip.limit) : null;
  const unitValueRs = settings?.unitValue != null ? Number(settings.unitValue) : null;
  if (limitRs === null || unitValueRs === null || unitValueRs <= 0) return { unit: requestedUnit, limitApplied: false };

  const requestedRs = requestedUnit * unitValueRs;
  if (requestedRs <= limitRs) return { unit: requestedUnit, limitApplied: false };
  return { unit: Math.round((limitRs / unitValueRs) * 100) / 100, limitApplied: true };
}

function serializeTip(tip: TipWithGroup, photoUrls: Map<string, string>, myTake: TipTakeRow | undefined): TelegramTip {
  return {
    id: tip.id,
    groupId: tip.groupId,
    groupName: tip.group.name,
    telegramMessageId: tip.telegramMessageId.toString(),
    match: tip.match,
    selection: tip.selection,
    marketType: tip.marketType as TelegramTip["marketType"],
    unit: tip.unit !== null ? Number(tip.unit) : null,
    odd: tip.odd !== null ? Number(tip.odd) : null,
    oddSource: tip.oddSource as TelegramTip["oddSource"],
    originalOdd: tip.originalOdd !== null ? Number(tip.originalOdd) : null,
    bookmaker: tip.bookmaker,
    betUrl: tip.betUrl,
    bookmakerOptions: (tip.bookmakerOptions as TelegramTip["bookmakerOptions"]) ?? null,
    photoUrl: tip.photoPath ? (photoUrls.get(tip.photoPath) ?? null) : null,
    result: tip.result as TelegramTip["result"],
    limit: tip.limit !== null ? Number(tip.limit) : null,
    needsReview: tip.needsReview,
    mine: {
      takenStatus: (myTake?.takenStatus as TelegramTip["mine"]["takenStatus"]) ?? "pending",
      unit: myTake?.unit != null ? Number(myTake.unit) : null,
      odd: myTake?.odd != null ? Number(myTake.odd) : null,
      bookmaker: myTake?.bookmaker ?? null,
      betUrl: myTake?.betUrl ?? null,
      limitApplied: myTake?.limitApplied ?? false,
    },
    parsePattern: tip.parsePattern,
    receivedAt: tip.receivedAt.toISOString(),
    rawMessage: tip.rawMessage,
  };
}

/** Início do dia (00:00 América/São Paulo, fixo em UTC-3 o ano todo desde
 * 2019 — mesma convenção do /today-summary) pra uma data civil "YYYY-MM-DD",
 * como instante UTC. */
function startOfSpDay(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!, 3, 0, 0));
}

/** Filtros de "escopo" compartilhados por GET / e GET /summary — grupo,
 * casa, busca e período. Nunca inclui result/takenStatus: cada endpoint
 * decide isso por conta (a lista respeita a aba/dropdown ativos; o resumo
 * força o critério de cada número, senão "pendentes"/"peguei" ficariam
 * sempre 0 assim que o usuário troca de aba). */
function buildScopeWhere(
  query: { groupId?: string; bookmaker?: string; marketType?: string; search?: string; dateFrom?: string; dateTo?: string },
  userId: string,
): Prisma.TelegramTipWhereInput {
  const { groupId, bookmaker, marketType, search, dateFrom, dateTo } = query;
  const groupIds = groupId ? groupId.split(",").filter(Boolean) : [];
  // dateTo é inclusivo — o corte real é o início do dia seguinte.
  const untilExclusive = dateTo ? new Date(startOfSpDay(dateTo).getTime() + 24 * 60 * 60 * 1000) : null;

  return {
    ...(groupIds.length === 1 ? { groupId: groupIds[0] } : groupIds.length > 1 ? { groupId: { in: groupIds } } : {}),
    // Uma tip com mais de uma casa possível guarda `bookmaker` NULL e as
    // opções em `bookmakerOptions` (ver parseTip.ts) — sem o AND/OR abaixo,
    // filtrar por "Betano" nunca encontrava essa tip mesmo com um link da
    // Betano nela. Usa AND (em vez de espalhar OR direto no objeto) porque
    // `search` abaixo também precisa do seu próprio OR — dois `OR` soltos no
    // mesmo objeto se sobrescreveriam.
    // A casa onde EU peguei (take.bookmaker, só com status "peguei") manda
    // sobre a casa oficial: uma tip que veio na R7 mas foi pega na 7games
    // aparece no filtro "7games" e some do "R7" — mesma regra do saldo por casa do perfil (GET /banca,
    // `mine.bookmaker ?? r.bookmaker`).
    ...(bookmaker
      ? {
          AND: [
            {
              OR: [
                { takes: { some: { userId, takenStatus: "taken", bookmaker } } },
                {
                  OR: [{ bookmaker }, { bookmakerOptions: { array_contains: [{ bookmaker }] } }],
                  takes: { none: { userId, takenStatus: "taken", bookmaker: { not: null }, NOT: { bookmaker } } },
                },
              ],
            },
          ],
        }
      : {}),
    ...(marketType ? { marketType } : {}),
    ...(search ? { OR: [{ match: { contains: search, mode: "insensitive" } }, { selection: { contains: search, mode: "insensitive" } }] } : {}),
    ...(dateFrom || untilExclusive
      ? { receivedAt: { ...(dateFrom ? { gte: startOfSpDay(dateFrom) } : {}), ...(untilExclusive ? { lt: untilExclusive } : {}) } }
      : {}),
  };
}

/** takenStatus é por usuário (relação TelegramTipTake), nunca uma coluna na
 * própria tip — compartilhado por GET / e GET /summary pra nunca divergir. */
function buildTakenFilter(takenStatus: string | undefined, userId: string): Prisma.TelegramTipWhereInput {
  if (takenStatus === "pending") return { takes: { none: { userId, takenStatus: { in: ["taken", "skipped"] } } } };
  if (takenStatus === "taken" || takenStatus === "skipped") return { takes: { some: { userId, takenStatus } } };
  return {};
}

/** green: stake × (odd − 1); red: −stake; reembolso: 0 — same convention
 * robot-signals/routes.ts uses. meio-green/meio-red: exactly half of the
 * full green/red profit — the Padovan "resultado parcial" convention (ex.
 * handicap/gol-linha "meio"), see resultFromEmoji.ts's RESULT_MARKER_RE. */
function tipProfit(unit: number, odd: number | null, result: string): number | null {
  if (result === "green") return odd ? unit * (odd - 1) : null;
  if (result === "red") return -unit;
  if (result === "reembolso") return 0;
  if (result === "meio-green") return odd ? (unit * (odd - 1)) / 2 : null;
  if (result === "meio-red") return -unit / 2;
  return null;
}

type BancaSourceRow = {
  unit: Prisma.Decimal | null;
  odd: Prisma.Decimal | null;
  bookmaker: string | null;
  groupName: string;
  result: string;
  receivedAt: Date;
  /** Bônus/turbinada em R$ pago por fora da odd (ver TelegramTipTake) —
   * sempre 0 no lado "geral" (é pessoal, não existe pra tip oficial). Só
   * entra na conta quando há unitValue pra converter em unidades. */
  bonusReais: number;
};

/** Cumulative profit in units, chronological by receivedAt — feeds the
 * "Evolução da banca" chart on the report page. Tips with a result but no
 * odd (missingOdd) contribute 0, same as they're excluded from `profit`
 * in aggregateBy. */
function series(rows: BancaSourceRow[], unitValue: number | null): { t: string; profit: number }[] {
  let cumulative = 0;
  return [...rows]
    .sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime())
    .map((r) => {
      const unit = r.unit !== null ? Number(r.unit) : 0;
      const odd = r.odd !== null ? Number(r.odd) : null;
      const pl = tipProfit(unit, odd, r.result);
      const bonusUnits = unitValue && pl !== null && r.bonusReais ? r.bonusReais / unitValue : 0;
      cumulative += (pl ?? 0) + bonusUnits;
      return { t: r.receivedAt.toISOString(), profit: Math.round(cumulative * 100) / 100 };
    });
}

/** `unitValue` (R$ per 1u) converts staked/profit to currency — null when the admin hasn't registered one yet. */
function aggregateBy(rows: BancaSourceRow[], keyFn: (r: BancaSourceRow) => string | null, unitValue: number | null): TelegramBancaRow[] {
  const map = new Map<
    string,
    { key: string; total: number; green: number; red: number; reembolso: number; staked: number; profit: number; missingOdd: number }
  >();

  for (const r of rows) {
    const key = keyFn(r) ?? "—";
    let g = map.get(key);
    if (!g) {
      g = { key, total: 0, green: 0, red: 0, reembolso: 0, staked: 0, profit: 0, missingOdd: 0 };
      map.set(key, g);
    }
    g.total++;
    // meio-green/meio-red count toward green/red for winrate purposes —
    // directionally still a win/loss, just half-sized (see tipProfit).
    if (r.result === "green" || r.result === "meio-green") g.green++;
    else if (r.result === "red" || r.result === "meio-red") g.red++;
    else if (r.result === "reembolso") g.reembolso++;

    const unit = r.unit !== null ? Number(r.unit) : 0;
    const odd = r.odd !== null ? Number(r.odd) : null;
    if (r.result !== "reembolso") g.staked += unit;
    const pl = tipProfit(unit, odd, r.result);
    if (pl === null) g.missingOdd++;
    else {
      const bonusUnits = unitValue && r.bonusReais ? r.bonusReais / unitValue : 0;
      g.profit += pl + bonusUnits;
    }
  }

  return [...map.values()]
    .map((g) => ({
      key: g.key,
      total: g.total,
      green: g.green,
      red: g.red,
      reembolso: g.reembolso,
      staked: Math.round(g.staked * 100) / 100,
      profit: Math.round(g.profit * 100) / 100,
      roiPct: g.staked > 0 ? Math.round((g.profit / g.staked) * 1000) / 10 : null,
      // Reembolso isn't a win or a loss — excluded from the winrate denominator.
      greenPct: g.green + g.red > 0 ? Math.round((g.green / (g.green + g.red)) * 1000) / 10 : null,
      missingOdd: g.missingOdd,
      stakedBRL: unitValue !== null ? Math.round(g.staked * unitValue * 100) / 100 : null,
      profitBRL: unitValue !== null ? Math.round(g.profit * unitValue * 100) / 100 : null,
    }))
    .sort((a, b) => b.profit - a.profit);
}

export async function telegramTipsRoutes(app: FastifyInstance) {
  // Personal tracker — gated by its own screen (telegram_banca), granted to
  // nobody by default; the user grants it to their own role via the
  // existing Admin → Roles UI.
  app.addHook("preHandler", authGuard);
  app.addHook("preHandler", roleGuard("telegram_banca"));

  void ensurePhotoBucket();

  // Nomes de casa já vistos nas tips — alimenta o select de saldo por casa
  // no perfil e o filtro de casa do dashboard, pra digitar sempre o mesmo
  // nome ("betano" vs "Betano"). Inclui tanto `bookmaker` quanto os nomes
  // dentro de `bookmakerOptions` — uma tip com mais de uma casa possível
  // grava `bookmaker` NULL (ver parseTip.ts), então uma casa que só aparece
  // ali dentro nunca apareceria no filtro sem isso.
  app.get("/bookmakers", async (): Promise<string[]> => {
    const rows = await prisma.$queryRaw<{ name: string }[]>`
      SELECT DISTINCT name FROM (
        SELECT bookmaker AS name FROM telegram_tips WHERE bookmaker IS NOT NULL
        UNION
        SELECT elem->>'bookmaker' AS name FROM telegram_tips, jsonb_array_elements(bookmaker_options) elem WHERE bookmaker_options IS NOT NULL
      ) names
      WHERE name IS NOT NULL
    `;
    return rows.map((r) => r.name).sort((a, b) => a.localeCompare(b));
  });

  /** Rewrites `bookmakerOptions` (a JSON array, so updateMany can't reach
   * inside it) on every tip that references `from` — used by both the
   * rename and delete routes below. `to: null` drops the option entirely
   * instead of renaming it. */
  async function rewriteBookmakerOptions(from: string, to: string | null) {
    const withOptions = await prisma.telegramTip.findMany({
      where: { bookmakerOptions: { not: Prisma.DbNull } },
      select: { id: true, bookmakerOptions: true },
    });
    for (const tip of withOptions) {
      const options = tip.bookmakerOptions as { bookmaker: string | null; betUrl: string | null }[] | null;
      if (!options?.some((o) => o.bookmaker === from)) continue;
      const next = to !== null ? options.map((o) => (o.bookmaker === from ? { ...o, bookmaker: to } : o)) : options.filter((o) => o.bookmaker !== from);
      await prisma.telegramTip.update({ where: { id: tip.id }, data: { bookmakerOptions: next.length > 0 ? next : Prisma.DbNull } });
    }
  }

  // Renomeia uma casa em toda tip que a referencia (bookmaker + dentro de
  // bookmakerOptions) e, quando existir, no saldo/cor por casa deste admin
  // (settings são por usuário — não mexe no de outros usuários). Admin only.
  // Canonicaliza o novo nome (mesma regra de apps/worker/src/parseTip.ts e
  // apps/web/src/lib/bookmakers.ts) — senão um rename manual reintroduziria
  // a mesma duplicata por acento/maiúscula que essa tela existe pra resolver.
  app.patch<{ Params: { name: string }; Body: { name?: string } }>("/bookmakers/:name", async (request, reply) => {
    if (request.authUser!.roleName !== "admin") return reply.code(403).send({ error: "forbidden" });
    const oldName = request.params.name;
    const rawNewName = request.body?.name?.trim();
    if (!rawNewName) return reply.code(400).send({ error: "invalid_input", details: "name is required" });
    const newName = rawNewName
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
    if (!newName) return reply.code(400).send({ error: "invalid_input", details: "name is required" });
    if (newName === oldName) return { renamed: 0 };

    const { count } = await prisma.telegramTip.updateMany({ where: { bookmaker: oldName }, data: { bookmaker: newName } });
    await rewriteBookmakerOptions(oldName, newName);
    // Sem isso, a aposta pessoal de quem já tinha marcado "Peguei" antes do
    // rename continua com o nome antigo/errado pra sempre (ex.: "bdeal"
    // sobrevivendo na banca do usuário depois de renomear a tip pra
    // "betfair") — a tabela "Casas de apostas" do perfil lê daqui, não de
    // TelegramTip.bookmaker.
    await prisma.telegramTipTake.updateMany({ where: { bookmaker: oldName }, data: { bookmaker: newName } });

    const settings = await prisma.telegramBancaSettings.findUnique({ where: { userId: request.authUser!.id } });
    const colors = settings?.bookmakerColors as Record<string, string> | null;
    if (colors && oldName in colors) {
      const { [oldName]: color, ...rest } = colors;
      await prisma.telegramBancaSettings.update({ where: { userId: request.authUser!.id }, data: { bookmakerColors: { ...rest, [newName]: color } } });
    }
    await prisma.telegramBookmakerBalance
      .update({ where: { userId_bookmaker: { userId: request.authUser!.id, bookmaker: oldName } }, data: { bookmaker: newName } })
      // No-op se este admin não tiver saldo pra essa casa, ou já tiver um pra newName (conflito de unique) — renomear a tip não deve falhar por isso.
      .catch(() => {});
    // Saques seguem o nome da casa, como os "peguei" acima (de todo usuário).
    await prisma.telegramBookmakerWithdrawal.updateMany({ where: { bookmaker: oldName }, data: { bookmaker: newName } });

    return { renamed: count };
  });

  // Remove uma casa de toda tip que a referencia (bookmaker vira null,
  // entrada correspondente some de bookmakerOptions) — nunca apaga a tip em
  // si, só o rótulo da casa. Admin only.
  app.delete<{ Params: { name: string } }>("/bookmakers/:name", async (request, reply) => {
    if (request.authUser!.roleName !== "admin") return reply.code(403).send({ error: "forbidden" });
    const name = request.params.name;

    const { count } = await prisma.telegramTip.updateMany({ where: { bookmaker: name }, data: { bookmaker: null } });
    await rewriteBookmakerOptions(name, null);
    await prisma.telegramTipTake.updateMany({ where: { bookmaker: name }, data: { bookmaker: null } });

    return { cleared: count };
  });

  // ── Grupos rastreados ──────────────────────────────────────────────────
  app.get("/groups", async () => {
    return prisma.telegramGroup.findMany({ orderBy: { name: "asc" } });
  });

  // Grupos são globais (definem quais chats o worker escuta e qual banca cada
  // grupo usa no grading) — só admin altera, como nas outras rotas de escrita.
  app.post("/groups", async (request, reply) => {
    if (request.authUser!.roleName !== "admin") return reply.code(403).send({ error: "forbidden" });
    const parsed = CreateTelegramGroupInput.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_input", details: parsed.error.flatten() });
    }
    const { name, telegramChatId } = parsed.data;
    // Sem chat: grupo só de tips manuais. Id sintético (nunca um número de
    // chat válido) e inativo — todo caminho do worker que fala com o
    // Telegram só lê grupos ativos, então ele nunca é escutado/consultado.
    const group = await prisma.telegramGroup.create({
      data: telegramChatId
        ? { name, telegramChatId }
        : { name, telegramChatId: `${MANUAL_GROUP_CHAT_PREFIX}${randomUUID()}`, active: false },
    });
    return reply.code(201).send(group);
  });

  app.patch<{ Params: { id: string } }>("/groups/:id", async (request, reply) => {
    if (request.authUser!.roleName !== "admin") return reply.code(403).send({ error: "forbidden" });
    const parsed = UpdateTelegramGroupInput.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_input", details: parsed.error.flatten() });
    }
    if (parsed.data.active) {
      const current = await prisma.telegramGroup.findUnique({ where: { id: request.params.id }, select: { telegramChatId: true } });
      // Ativar um grupo manual faria o worker chamar o Telegram com um chat id inválido.
      if (current?.telegramChatId.startsWith(MANUAL_GROUP_CHAT_PREFIX)) {
        return reply.code(400).send({ error: "manual_group_cannot_be_active" });
      }
    }
    const group = await prisma.telegramGroup.update({ where: { id: request.params.id }, data: parsed.data });
    return group;
  });

  // ── Tips ──────────────────────────────────────────────────────────────
  app.get<{
    Querystring: {
      page?: string;
      limit?: string;
      groupId?: string;
      bookmaker?: string;
      marketType?: string;
      result?: string;
      takenStatus?: string;
      search?: string;
      dateFrom?: string;
      dateTo?: string;
      /** Comma list of "odd"|"unit"|"match"|"selection"|"bookmaker" — tips
       * missing ANY of these (OR'd together) — the Admin "Tips oficiais"
       * screen's audit filters (odd/jogo/mercado/casa/unidade faltando). */
      missing?: string;
      /** "true" — só tips que o auto-grader diário do bet-analytix marcou
       * como ambíguas (needsReview), pra revisão manual no Admin. */
      needsReview?: string;
    };
  }>("/", async (request) => {
    const page = Math.max(1, parseInt(request.query.page ?? "1", 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(request.query.limit ?? "20", 10) || 20));
    const { result, takenStatus, missing, needsReview } = request.query;
    const userId = request.authUser!.id;

    const takenFilter = buildTakenFilter(takenStatus, userId);

    const missingFields = missing ? missing.split(",").filter(Boolean) : [];
    const missingFilter: Prisma.TelegramTipWhereInput =
      missingFields.length > 0
        ? {
            OR: missingFields
              .map((f): Prisma.TelegramTipWhereInput | null => {
                if (f === "odd" || f === "unit" || f === "match" || f === "bookmaker") return { [f]: null };
                // `selection` fica "" (não null) quando processMessage.ts cria a tip
                // sem mercado no texto — as duas formas contam como "faltando".
                if (f === "selection") return { OR: [{ selection: null }, { selection: "" }] };
                return null;
              })
              .filter((f): f is Prisma.TelegramTipWhereInput => f !== null),
          }
        : {};

    const where: Prisma.TelegramTipWhereInput = {
      ...buildScopeWhere(request.query, userId),
      ...(result ? { result } : {}),
      ...takenFilter,
      ...missingFilter,
      ...(needsReview === "true" ? { needsReview: true } : {}),
    };

    const [total, rows] = await Promise.all([
      prisma.telegramTip.count({ where }),
      prisma.telegramTip.findMany({
        where,
        include: { group: { select: { name: true } } },
        orderBy: { receivedAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    const [photoUrls, myTakes] = await Promise.all([
      resolvePhotoUrls(rows.map((r) => r.photoPath)),
      fetchMyTakes(rows.map((r) => r.id), userId),
    ]);

    return {
      data: rows.map((r) => serializeTip(r, photoUrls, myTakes.get(r.id))),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  });

  // Números dos cards do topo (Tips pendentes / Peguei / Resultado) — segue
  // TODOS os filtros ativos (grupo/casa/busca/período + a aba de resultado e
  // o dropdown Peguei/Não peguei), igual à lista abaixo. Pode legitimamente
  // voltar 0 numa combinação estranha (ex.: aba "Green" + "Tips Pendentes",
  // já que uma tip pendente nunca tem result=green) — intencional, o usuário
  // prefere ver o número condizer com o filtro a um número sempre "cheio".
  app.get<{
    Querystring: {
      groupId?: string;
      bookmaker?: string;
      marketType?: string;
      search?: string;
      dateFrom?: string;
      dateTo?: string;
      result?: string;
      takenStatus?: string;
    };
  }>("/summary", async (request) => {
    const { result, takenStatus } = request.query;
    const userId = request.authUser!.id;
    const filtered: Prisma.TelegramTipWhereInput = {
      AND: [buildScopeWhere(request.query, userId), result ? { result } : {}, buildTakenFilter(takenStatus, userId)],
    };
    const notDecided: Prisma.TelegramTipWhereInput = { takes: { none: { userId, takenStatus: { in: ["taken", "skipped"] } } } };
    const isTaken: Prisma.TelegramTipWhereInput = { takes: { some: { userId, takenStatus: "taken" } } };

    const [pendingCount, taken] = await Promise.all([
      prisma.telegramTip.count({ where: { AND: [filtered, notDecided] } }),
      prisma.telegramTip.findMany({
        where: { AND: [filtered, isTaken] },
        select: { result: true, takes: { where: { userId }, select: { unit: true, odd: true } } },
      }),
    ]);

    let takenUnits = 0;
    let resultUnits = 0;
    for (const t of taken) {
      const mine = t.takes[0]!;
      const unit = mine.unit !== null ? Number(mine.unit) : 0;
      takenUnits += unit;
      const odd = mine.odd !== null ? Number(mine.odd) : null;
      resultUnits += tipProfit(unit, odd, t.result) ?? 0;
    }

    return {
      pendingCount,
      takenCount: taken.length,
      takenUnits: Math.round(takenUnits * 100) / 100,
      resultUnits: Math.round(resultUnits * 100) / 100,
    };
  });

  // Total de tips "não decididas" por ESTE usuário, geral e por grupo — só
  // pro badge do filtro de grupo (GroupMultiSelect). Conta de verdade
  // (agregada no banco, sem limite de página nenhum) — nunca buscar as
  // linhas só pra contar (todo endpoint de lista aqui trava em 100 por
  // página, então contar via `.data.length` sempre subestima passado isso).
  app.get("/pending-counts", async (request) => {
    const userId = request.authUser!.id;
    const notDecided: Prisma.TelegramTipWhereInput = { takes: { none: { userId, takenStatus: { in: ["taken", "skipped"] } } } };

    const [total, byGroup] = await Promise.all([
      prisma.telegramTip.count({ where: notDecided }),
      prisma.telegramTip.groupBy({ by: ["groupId"], where: notDecided, _count: true }),
    ]);

    return { total, byGroup: byGroup.map((g) => ({ groupId: g.groupId, count: g._count })) };
  });

  // Corrige o registro OFICIAL da tip (odd/unidade/casa/link/mercado/jogo/
  // resultado) — o que o tipster falou de verdade e como resolveu, igual
  // pra todo mundo. Editável só pelo admin (tela /admin/telegram-tips);
  // acompanhamento pessoal (peguei/não peguei + minha unidade/odd/casa) é
  // outro endpoint, ver PATCH /:id/take.
  app.patch<{ Params: { id: string } }>("/:id", { bodyLimit: 10 * 1024 * 1024 }, async (request, reply) => {
    if (request.authUser!.roleName !== "admin") return reply.code(403).send({ error: "forbidden" });
    const parsed = UpdateTelegramTipInput.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_input", details: parsed.error.flatten() });
    }
    const input = parsed.data;

    const existing = await prisma.telegramTip.findUnique({
      where: { id: request.params.id },
      select: { groupId: true, telegramMessageId: true, parsePattern: true },
    });
    if (!existing) return reply.code(404).send({ error: "not_found" });

    // Grupo e hora identificam a mensagem de origem de uma tip do Telegram
    // (rebuild/reações/aposta automática dependem deles) — só a manual muda.
    const isManual = existing.parsePattern === "manual";
    if (!isManual && (input.groupId !== undefined || input.receivedAt !== undefined)) {
      return reply.code(400).send({ error: "only_manual_tips" });
    }
    if (input.groupId !== undefined) {
      const group = await prisma.telegramGroup.findUnique({ where: { id: input.groupId }, select: { id: true } });
      if (!group) return reply.code(400).send({ error: "unknown_group" });
    }

    // A foto é da mensagem, não de uma seleção: trocar/remover vale pra todas
    // as tips que vieram na mesma mensagem (mesmo bilhete). A foto antiga
    // nunca é apagada do Storage aqui (mesma regra do DELETE /:id).
    let nextPhotoPath: string | null | undefined;
    if (input.photoBase64 === null) nextPhotoPath = null;
    else if (input.photoBase64 !== undefined) {
      const uploaded = await uploadAdminPhoto(input.photoBase64, input.groupId ?? existing.groupId);
      if ("error" in uploaded) return reply.code(uploaded.status).send({ error: uploaded.error });
      nextPhotoPath = uploaded.path;
    }
    if (nextPhotoPath !== undefined) {
      await prisma.telegramTip.updateMany({
        where: { groupId: existing.groupId, telegramMessageId: existing.telegramMessageId },
        data: { photoPath: nextPhotoPath },
      });
    }

    // Corrigir a casa oficial (ex.: "bdeal" -> "betfair", um hostname mal
    // reconhecido) só trocava a coluna `bookmaker` — o mesmo nome errado
    // sobrevivia dentro de `bookmakerOptions` (as casas alternativas que o
    // parser achou na mensagem original) e continuava vazando pro dropdown
    // "+casa" via GET /bookmakers, que varre as duas fontes. Sempre que a
    // casa muda de um valor definido pra outro, propaga o mesmo rename pras
    // opções desta tip — nunca mexe nas opções quando `bookmaker` estava
    // null (tip genuinamente ambígua entre casas, ver parseTip.ts), pra não
    // apagar alternativas válidas que outra pessoa ainda pode escolher.
    let nextBookmakerOptions: Prisma.InputJsonValue | undefined;
    if (input.bookmaker !== undefined && input.bookmaker !== null) {
      const current = await prisma.telegramTip.findUnique({
        where: { id: request.params.id },
        select: { bookmaker: true, bookmakerOptions: true },
      });
      if (current?.bookmaker && current.bookmaker !== input.bookmaker && Array.isArray(current.bookmakerOptions)) {
        const options = current.bookmakerOptions as { bookmaker: string | null; betUrl: string | null }[];
        if (options.some((o) => o.bookmaker === current.bookmaker)) {
          nextBookmakerOptions = options.map((o) =>
            o.bookmaker === current.bookmaker ? { ...o, bookmaker: input.bookmaker } : o,
          ) as Prisma.InputJsonValue;
        }
      }
    }

    const tip = await prisma.telegramTip.update({
      where: { id: request.params.id },
      data: {
        // Gradar manualmente resolve qualquer "precisa revisar" que o
        // auto-grader diário do bet-analytix tenha deixado pra essa tip.
        ...(input.result !== undefined ? { result: input.result, needsReview: false } : {}),
        ...(input.unit !== undefined ? { unit: input.unit } : {}),
        ...(input.selection !== undefined ? { selection: input.selection } : {}),
        ...(input.marketType !== undefined ? { marketType: input.marketType } : {}),
        ...(input.match !== undefined ? { match: input.match } : {}),
        ...(input.bookmaker !== undefined ? { bookmaker: input.bookmaker } : {}),
        ...(nextBookmakerOptions !== undefined ? { bookmakerOptions: nextBookmakerOptions } : {}),
        ...(input.betUrl !== undefined ? { betUrl: input.betUrl } : {}),
        ...(input.odd !== undefined ? { odd: input.odd, oddSource: input.odd !== null ? "manual" : null } : {}),
        ...(input.limit !== undefined ? { limit: input.limit } : {}),
        ...(input.rawMessage !== undefined ? { rawMessage: input.rawMessage || null } : {}),
        ...(input.groupId !== undefined ? { groupId: input.groupId } : {}),
        ...(input.receivedAt !== undefined ? { receivedAt: new Date(input.receivedAt) } : {}),
      },
      include: { group: { select: { name: true } } },
    });

    if (nextPhotoPath) await enqueueOcrIfMissing(tip);

    const [photoUrls, myTakes] = await Promise.all([
      resolvePhotoUrls([tip.photoPath]),
      fetchMyTakes([tip.id], request.authUser!.id),
    ]);
    return serializeTip(tip, photoUrls, myTakes.get(tip.id));
  });

  // Acompanhamento pessoal: se EU peguei essa tip, e se peguei, com qual
  // unidade/odd/casa. Sempre grava no próprio usuário (nunca um userId do
  // corpo) — qualquer um com telegram_banca pode usar, sem gate de admin.
  app.patch<{ Params: { id: string } }>("/:id/take", async (request, reply) => {
    const parsed = UpdateTelegramTipTakeInput.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_input", details: parsed.error.flatten() });
    }
    const userId = request.authUser!.id;
    const tipId = request.params.id;
    const input = parsed.data;

    // Limite de aposta da casa (ver applyStakeLimit) só se aplica quando a
    // unidade está sendo tocada nesta chamada — odd/casa/link/status sozinhos
    // nunca recalculam nem mexem em limitApplied.
    const data =
      input.unit !== undefined && input.unit !== null
        ? { ...input, ...(await applyStakeLimit(tipId, userId, input.unit)) }
        : input;

    const tip = await prisma.telegramTip.findUniqueOrThrow({
      where: { id: tipId },
      include: { group: { select: { name: true } } },
    });

    // Quando a casa não veio explícita neste PATCH (ex.: só editando odd/
    // unidade) e a tip tem só UM candidato possível — casa única ou
    // bookmakerOptions com 1 item só —, preenche sozinho. Sem isso, uma take
    // "taken" ficava com bookmaker null pra sempre (visível como "—" no
    // saldo por casa) só porque ninguém tocou no seletor depois do 👍
    // automático — dinheiro que sumia de qualquer saldo por casa.
    let finalData = data;
    if (data.bookmaker === undefined) {
      const existingTake = await prisma.telegramTipTake.findUnique({
        where: { tipId_userId: { tipId, userId } },
        select: { bookmaker: true, takenStatus: true },
      });
      const willBeTaken = data.takenStatus === "taken" || (data.takenStatus === undefined && existingTake?.takenStatus === "taken");
      if (willBeTaken && !existingTake?.bookmaker) {
        const options = tip.bookmakerOptions as { bookmaker: string }[] | null;
        const single = options && options.length === 1 ? options[0]!.bookmaker : !options && tip.bookmaker ? tip.bookmaker : null;
        if (single) finalData = { ...data, bookmaker: single };
      }
    }

    await prisma.telegramTipTake.upsert({
      where: { tipId_userId: { tipId, userId } },
      create: { tipId, userId, ...finalData },
      update: finalData,
    });

    const [photoUrls, myTakes] = await Promise.all([resolvePhotoUrls([tip.photoPath]), fetchMyTakes([tipId], userId)]);
    return serializeTip(tip, photoUrls, myTakes.get(tipId));
  });

  // Importa o histórico de apostas de uma casa (extraído pelo próprio
  // usuário no navegador — ver scripts/bookmaker-scrapers/, nunca um
  // scraping nosso nem senha guardada) e casa cada aposta contra as tips
  // que ELE ainda não decidiu (ou já decidiu na MESMA casa — dá pra
  // corrigir/refinar), de qualquer grupo (a odd+jogo da aposta real é quem
  // resolve, não precisa saber o tipster de antemão — ver matchBookmakerBet
  // em @evobo/worker). Sem gate de admin: é o histórico PESSOAL de quem
  // está importando, mesma regra do PATCH /:id/take — só mexe em
  // peguei/odd/unidade, NUNCA no `result` oficial (isso é admin-only, ver
  // POST /admin/import-results abaixo). `dryRun` (default true) calcula
  // tudo sem gravar nada.
  app.post("/import-bets", async (request, reply): Promise<ImportBookmakerBetsResult> => {
    const parsed = ImportBookmakerBetsInput.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_input", details: parsed.error.flatten() }) as never;
    }
    const { bookmaker, bets, dryRun = true } = parsed.data;
    const userId = request.authUser!.id;

    const [settings, candidateTips] = await Promise.all([
      prisma.telegramBancaSettings.findUnique({ where: { userId }, select: { unitValue: true } }),
      prisma.telegramTip.findMany({
        // Candidata quando ainda não foi decidida OU já foi decidida mas na
        // MESMA casa que está sendo importada agora (permite corrigir/
        // refinar odd/unidade quando o valor manual foi só uma aproximação
        // — validado contra a Esportes da Sorte). Nunca mexe numa tip já
        // atribuída a OUTRA casa, pra não misturar dados de contas diferentes.
        where: {
          OR: [{ takes: { none: { userId } } }, { takes: { some: { userId, OR: [{ bookmaker }, { bookmaker: null }] } } }],
        },
        select: {
          id: true,
          match: true,
          selection: true,
          unit: true,
          odd: true,
          originalOdd: true,
          limit: true,
          result: true,
          receivedAt: true,
          takes: {
            where: { userId },
            select: { id: true, takenStatus: true, unit: true, odd: true, bookmaker: true, bonusReais: true },
          },
        },
      }),
    ]);
    const unitValueReais = settings?.unitValue != null ? Number(settings.unitValue) : null;

    const remaining: CandidateTip[] = candidateTips.map((t) => ({
      id: t.id,
      match: t.match,
      selection: t.selection,
      unit: t.unit !== null ? Number(t.unit) : null,
      odd: t.odd !== null ? Number(t.odd) : null,
      originalOdd: t.originalOdd !== null ? Number(t.originalOdd) : null,
      limit: t.limit !== null ? Number(t.limit) : null,
      currentResult: t.result as TelegramTip["result"],
      receivedAt: t.receivedAt,
    }));
    const takeByTipId = new Map(candidateTips.map((t) => [t.id, t.takes[0] ?? null]));

    const result: ImportBookmakerBetsResult = { dryRun, matched: [], ambiguous: [], divergent: [], unmatched: [] };

    // Cada tip só pode "explicar" UMA aposta real por importação — sem isso,
    // uma tip já corretamente registrada (odd batendo) ficava sendo
    // reaproveitada pra toda outra aposta real que coincidisse na mesma odd,
    // acusando divergência numa tip que já está certa (a divergência de
    // verdade era só uma segunda aposta real sem tip correspondente).
    const claimedTipIds = new Set<string>();

    for (const bet of bets) {
      const outcome = matchBookmakerBet(bet, remaining, unitValueReais);

      if (outcome.kind === "unmatched") {
        // O casamento normal (odd+jogo/texto) não achou nada, mas já existe
        // uma take NESSA MESMA casa com a odd exatamente igual — sinal bom
        // demais pra descartar (o texto pode não bater só porque o combo
        // estava recolhido na tela quando o script rodou). Nunca grava
        // sozinho, só reporta pra revisão manual.
        const divergentTip = candidateTips.find((t) => {
          if (claimedTipIds.has(t.id)) return false;
          const take = t.takes[0];
          if (take?.bookmaker !== bookmaker || take.odd === null || Math.abs(Number(take.odd) - bet.odd) > ODD_TOLERANCE) return false;
          // Mesmo critério forte de jogo do casamento normal — sem isso,
          // odds comuns (ex.: 1.91) casavam QUALQUER aposta real não
          // reivindicada com QUALQUER tip não reivindicada só por
          // coincidência de odd, ignorando o jogo por completo (confirmado
          // em produção: uma combinada de Galatasaray/Benfica/Bayern
          // "corrigiu" errado a tip de Crystal Palace x Ipswich Town). Só
          // dispensa a comparação quando falta jogo de um dos lados (ex.:
          // combo recolhida na tela sem nome de time) — aí mantém o
          // comportamento original.
          if (bet.game !== null && t.match !== null) return textSimilarity(bet.game, t.match) >= GAME_SIMILARITY_THRESHOLD;
          return true;
        });
        if (divergentTip) {
          claimedTipIds.add(divergentTip.id);
          const take = divergentTip.takes[0]!;
          const recordedUnit = take.unit !== null ? Number(take.unit) : null;
          const impliedUnit = unitValueReais !== null ? Math.round((bet.stakeReais / unitValueReais) * 100) / 100 : null;
          // Só é divergência de verdade quando os dois números realmente
          // diferem — quando batem, o casamento normal só não achou por
          // causa do texto (ex.: combo recolhida na tela), não por erro
          // nenhum. Tolerância pequena (R$1 no valor da unidade) pra não
          // acusar arredondamento como se fosse erro.
          const unitTolerance = unitValueReais !== null ? 1 / unitValueReais : 0.05;
          const reallyDiverges =
            recordedUnit === null || impliedUnit === null || Math.abs(recordedUnit - impliedUnit) > unitTolerance;

          if (reallyDiverges) {
            result.divergent.push({ bet, tipId: divergentTip.id, match: divergentTip.match, selection: divergentTip.selection, recordedUnit, impliedUnit });
          } else {
            result.matched.push({
              bet,
              tipId: divergentTip.id,
              match: divergentTip.match,
              selection: divergentTip.selection,
              unit: recordedUnit,
              odd: bet.odd,
              result: null,
              current: dryRun
                ? {
                    takenStatus: (take.takenStatus as TelegramTip["mine"]["takenStatus"]) ?? "pending",
                    unit: recordedUnit,
                    odd: Number(take.odd),
                    result: divergentTip.result as TelegramTip["result"],
                  }
                : null,
            });
            // Unit/odd/bookmaker já batem — só preenche o bônus se ainda
            // não tinha (nunca sobrescreve um bônus já registrado por outro
            // caminho, ex.: editado na mão).
            if (!dryRun && bet.bonusReais && take.bonusReais === null) {
              await prisma.telegramTipTake.update({ where: { id: take.id }, data: { bonusReais: bet.bonusReais } });
            }
          }
        } else {
          result.unmatched.push(bet);
        }
        continue;
      }
      if (outcome.kind === "ambiguous") {
        result.ambiguous.push({
          bet,
          candidates: outcome.candidates.map((c) => ({ tipId: c.id, match: c.match, selection: c.selection, unit: c.unit })),
        });
        continue;
      }

      const { value } = outcome;
      // Tira do pool pra outra aposta do mesmo import não reaproveitar a
      // mesma tip (mesmo dry run: o que se mostraria já reflete isso).
      const idx = remaining.findIndex((c) => c.id === value.tipId);
      const original = idx !== -1 ? remaining.splice(idx, 1)[0]! : undefined;
      const existingTake = takeByTipId.get(value.tipId) ?? null;
      claimedTipIds.add(value.tipId);

      result.matched.push({
        bet,
        ...value,
        result: null, // resultado oficial nunca sai daqui — ver /admin/import-results
        current:
          dryRun && original
            ? {
                takenStatus: (existingTake?.takenStatus as TelegramTip["mine"]["takenStatus"]) ?? "pending",
                unit: existingTake ? Number(existingTake.unit) : null,
                odd: existingTake ? Number(existingTake.odd) : null,
                result: original.currentResult,
              }
            : null,
      });

      if (!dryRun) {
        const bonusReais = bet.bonusReais ?? null;
        await prisma.telegramTipTake.upsert({
          where: { tipId_userId: { tipId: value.tipId, userId } },
          create: { tipId: value.tipId, userId, takenStatus: "taken", unit: value.unit, odd: value.odd, bookmaker, bonusReais },
          update: { takenStatus: "taken", unit: value.unit, odd: value.odd, bookmaker, bonusReais },
        });
      }
    }

    return result;
  });

  // Tip que chegou fora dos grupos monitorados (DM, outro chat, print) —
  // o admin cadastra à mão com foto/unidade/odd/limite/grupo. Vira uma
  // TelegramTip comum (entra em banca, relatório e grading), com
  // parsePattern "manual" e telegramMessageId NEGATIVO: nunca colide com um
  // id real do Telegram, então rebuild/fill-gaps (que apagam/deduplicam por
  // id de mensagem) e as reações ✅/❌ nunca a tocam, e a fila da aposta
  // automática a ignora (ver betting-queue). Admin only.
  app.post("/manual", { bodyLimit: 10 * 1024 * 1024 }, async (request, reply) => {
    if (request.authUser!.roleName !== "admin") return reply.code(403).send({ error: "forbidden" });
    const parsed = CreateManualTelegramTipInput.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_input", details: parsed.error.flatten() });
    }
    const input = parsed.data;

    const group = await prisma.telegramGroup.findUnique({ where: { id: input.groupId }, select: { id: true } });
    if (!group) return reply.code(400).send({ error: "unknown_group" });

    let photoPath: string | null = null;
    if (input.photoBase64) {
      const uploaded = await uploadAdminPhoto(input.photoBase64, group.id);
      if ("error" in uploaded) return reply.code(uploaded.status).send({ error: uploaded.error });
      photoPath = uploaded.path;
    }

    const odd = input.odd ?? null;
    const tip = await prisma.telegramTip.create({
      data: {
        groupId: group.id,
        telegramMessageId: BigInt(-Date.now()),
        receivedAt: input.receivedAt ? new Date(input.receivedAt) : new Date(),
        match: input.match || null,
        // "" = mercado faltando, mesma convenção do processMessage.ts.
        selection: input.selection || "",
        marketType: input.marketType ?? null,
        unit: input.unit,
        odd,
        oddSource: odd !== null ? "manual" : null,
        bookmaker: input.bookmaker || null,
        betUrl: input.betUrl ?? null,
        limit: input.limit ?? null,
        photoPath,
        parsePattern: "manual",
        rawMessage: input.rawMessage || null,
      },
      include: { group: { select: { name: true } } },
    });

    // Mesma OCR das tips do Telegram, só pro que ficou em branco.
    await enqueueOcrIfMissing(tip);

    const [photoUrls, myTakes] = await Promise.all([
      resolvePhotoUrls([tip.photoPath]),
      fetchMyTakes([tip.id], request.authUser!.id),
    ]);
    return reply.code(201).send(serializeTip(tip, photoUrls, myTakes.get(tip.id)));
  });

  // Apaga a tip de vez (chat/correção que nunca devia ter virado tip, ou
  // duplicata) — nunca a foto no Storage, que outras tips do mesmo bilhete
  // podem compartilhar. Admin only.
  app.delete<{ Params: { id: string } }>("/:id", async (request, reply) => {
    if (request.authUser!.roleName !== "admin") return reply.code(403).send({ error: "forbidden" });
    await prisma.telegramTip.delete({ where: { id: request.params.id } });
    return { deleted: true };
  });

  // Reset pontual pra reconstruir o histórico com o parser já corrigido —
  // apaga e reimporta só as tips de mensagens em [sinceUnix, untilUnix]
  // (untilUnix omitido = até agora), reusando a sessão MTProto já conectada
  // do worker (roda no mesmo processo, sem SSH nem conexão duplicada).
  // Tudo fora da janela fica intocado. Admin only, ação destrutiva.
  app.post<{ Body: { sinceUnix: number; untilUnix?: number } }>("/admin/rebuild", async (request, reply) => {
    if (request.authUser!.roleName !== "admin") return reply.code(403).send({ error: "forbidden" });
    const { sinceUnix, untilUnix } = request.body ?? {};
    if (typeof sinceUnix !== "number" || !Number.isFinite(sinceUnix)) {
      return reply.code(400).send({ error: "invalid_input", details: "sinceUnix (unix seconds) is required" });
    }
    if (untilUnix !== undefined && (typeof untilUnix !== "number" || !Number.isFinite(untilUnix))) {
      return reply.code(400).send({ error: "invalid_input", details: "untilUnix, when given, must be unix seconds" });
    }

    const { runBackfillSince } = await import("@evobo/worker");
    const results = await runBackfillSince(sinceUnix, untilUnix);
    return { results };
  });

  // Igual ao /admin/rebuild acima, mas NUNCA apaga tips existentes na janela
  // — só preenche mensagens que ficaram de fora (ex.: chegaram bem na hora
  // de um deploy/restart do worker), sem arriscar perder peguei/não peguei
  // ou resultado de outra tip que já exista nessa mesma janela. Admin only,
  // não-destrutivo.
  app.post<{ Body: { sinceUnix: number; untilUnix?: number } }>("/admin/fill-gaps", async (request, reply) => {
    if (request.authUser!.roleName !== "admin") return reply.code(403).send({ error: "forbidden" });
    const { sinceUnix, untilUnix } = request.body ?? {};
    if (typeof sinceUnix !== "number" || !Number.isFinite(sinceUnix)) {
      return reply.code(400).send({ error: "invalid_input", details: "sinceUnix (unix seconds) is required" });
    }
    if (untilUnix !== undefined && (typeof untilUnix !== "number" || !Number.isFinite(untilUnix))) {
      return reply.code(400).send({ error: "invalid_input", details: "untilUnix, when given, must be unix seconds" });
    }

    const { runFillGapsSince } = await import("@evobo/worker");
    const results = await runFillGapsSince(sinceUnix, untilUnix);
    return { results };
  });

  // Reenfileira OCR só pra tips que já existem mas ainda faltam odd/mercado/
  // jogo (a foto já foi baixada) — nunca apaga/recria a tip, só preenche o
  // que falta. Sem parâmetro de período: sempre pega TODAS as tips
  // incompletas com foto, não só uma janela. Admin only, não-destrutivo.
  app.post("/admin/retry-ocr", async (request, reply) => {
    if (request.authUser!.roleName !== "admin") return reply.code(403).send({ error: "forbidden" });
    const { retryMissingOcr } = await import("@evobo/worker");
    const result = await retryMissingOcr();
    return result;
  });

  // Dispara sob demanda a checagem diária no bet-analytix (normalmente roda
  // sozinha às 3h) — grada green/red/reembolso quando o match é confiável,
  // marca needsReview quando é ambíguo, nunca mexe em tips já gradadas.
  // Admin only.
  app.post("/admin/grade-now", async (request, reply) => {
    if (request.authUser!.roleName !== "admin") return reply.code(403).send({ error: "forbidden" });
    const { runDailyGrading } = await import("@evobo/worker");
    const result = await runDailyGrading();
    return result;
  });

  // Mesmo import de histórico de apostas de POST /import-bets, mas do lado
  // OPOSTO: só grada o `result` OFICIAL (green/red/reembolso) — nunca mexe
  // em peguei/odd/unidade de ninguém (isso é pessoal, ver /import-bets
  // acima). Faz sentido ser admin-only: resultado é um fato objetivo, igual
  // pra todo mundo, não uma escolha de cada usuário. Nunca sobrescreve uma
  // tip que já tem result !== "pending", mesma regra de todo outro grader
  // (bet-analytix, reação ✅/❌). Admin only.
  app.post("/admin/import-results", async (request, reply): Promise<ImportBookmakerBetsResult> => {
    if (request.authUser!.roleName !== "admin") return reply.code(403).send({ error: "forbidden" });
    const parsed = ImportBookmakerBetsInput.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_input", details: parsed.error.flatten() }) as never;
    }
    const { bets, dryRun = true } = parsed.data;

    const candidateTips = await prisma.telegramTip.findMany({
      select: {
        id: true,
        match: true,
        selection: true,
        unit: true,
        odd: true,
        originalOdd: true,
        limit: true,
        result: true,
        receivedAt: true,
      },
    });
    const remaining: CandidateTip[] = candidateTips.map((t) => ({
      id: t.id,
      match: t.match,
      selection: t.selection,
      unit: t.unit !== null ? Number(t.unit) : null,
      odd: t.odd !== null ? Number(t.odd) : null,
      originalOdd: t.originalOdd !== null ? Number(t.originalOdd) : null,
      limit: t.limit !== null ? Number(t.limit) : null,
      currentResult: t.result as TelegramTip["result"],
      receivedAt: t.receivedAt,
    }));

    const result: ImportBookmakerBetsResult = { dryRun, matched: [], ambiguous: [], divergent: [], unmatched: [] };

    for (const bet of bets) {
      // unitValueReais null de propósito: aqui não interessa a unidade
      // pessoal de ninguém, só o resultado — sem ele, o desempate por
      // "unidade implícita" não roda, então 2+ candidatas na mesma odd/jogo
      // viram "ambíguo" em vez de arriscar gradar a tip errada.
      const outcome = matchBookmakerBet(bet, remaining, null);

      if (outcome.kind === "unmatched") {
        result.unmatched.push(bet);
        continue;
      }
      if (outcome.kind === "ambiguous") {
        result.ambiguous.push({
          bet,
          candidates: outcome.candidates.map((c) => ({ tipId: c.id, match: c.match, selection: c.selection, unit: c.unit })),
        });
        continue;
      }

      const { value } = outcome;
      const idx = remaining.findIndex((c) => c.id === value.tipId);
      const original = idx !== -1 ? remaining.splice(idx, 1)[0]! : undefined;

      result.matched.push({
        bet,
        tipId: value.tipId,
        match: value.match,
        selection: value.selection,
        unit: null,
        odd: value.odd,
        result: value.result,
        current: dryRun && original ? { takenStatus: "pending", unit: null, odd: original.odd, result: original.currentResult } : null,
      });

      if (!dryRun && value.result !== null) {
        await prisma.telegramTip.update({ where: { id: value.tipId }, data: { result: value.result, needsReview: false } });
      }
    }

    return result;
  });

  // Aplica ✅✅✅/❌❌❌ retroativamente nas mensagens do Super Odds já
  // importadas antes do listener de edição existir (ver resultFromEmoji.ts
  // no worker) — sempre sobrescreve `result`, mesmo se já gradado. Admin
  // only, não-destrutivo (nunca apaga/recria tip).
  app.post("/admin/backfill-result-emoji", async (request, reply) => {
    if (request.authUser!.roleName !== "admin") return reply.code(403).send({ error: "forbidden" });
    const { runBackfillResultFromEmoji } = await import("@evobo/worker");
    const results = await runBackfillResultFromEmoji();
    return { results };
  });

  // Aplica retroativamente os 👍/👎 que a conta do worker já tinha dado antes
  // do listener de reação existir (ver reactionTake.ts no worker) — cobre
  // TODOS os grupos. Admin only, não-destrutivo (upsert, nunca apaga take).
  app.post("/admin/backfill-reaction-take", async (request, reply) => {
    if (request.authUser!.roleName !== "admin") return reply.code(403).send({ error: "forbidden" });
    const { runBackfillReactionTake } = await import("@evobo/worker");
    const results = await runBackfillReactionTake();
    return { results };
  });

  // ── Gestão de banca ───────────────────────────────────────────────────
  // "geral" = todas as tips resolvidas com o registro OFICIAL (mede o
  // grupo/tipster, igual pra todo mundo); "peguei" = só as que este usuário
  // marcou como tomadas, com a unidade/odd/casa PESSOAIS dele — pode diferir
  // do oficial (stake menor, casa diferente etc.). result sempre é oficial
  // nos dois (é um fato objetivo, não uma escolha pessoal).
  app.get<{ Querystring: { bookmaker?: string; days?: string } }>("/banca", async (request) => {
    const bookmakerRaw = request.query.bookmaker?.trim();
    // "__none__" filtra por SEM casa registrada (bookmaker null) — distinto
    // de omitir o filtro (undefined = todas as casas). Sentinela nunca
    // colide com uma casa de verdade: normalizeBookmakerSlug só produz
    // [a-z0-9], nunca underscore.
    const bookmaker: string | null | undefined = bookmakerRaw === "__none__" ? null : bookmakerRaw || undefined;
    const matchesBookmaker = (value: string | null) => bookmaker === undefined || value === bookmaker;
    const userId = request.authUser!.id;
    // "7" | "30" | "90" | absent/"all" — scopes the whole summary (chart,
    // totals, breakdowns) to tips received in that window.
    const days = request.query.days ? Number(request.query.days) : null;
    const since = days && Number.isFinite(days) && days > 0 ? new Date(Date.now() - days * 24 * 60 * 60 * 1000) : null;
    const [rows, openTakes, settings] = await Promise.all([
      prisma.telegramTip.findMany({
        where: {
          result: { not: "pending" },
          ...(since ? { receivedAt: { gte: since } } : {}),
        },
        select: {
          unit: true,
          odd: true,
          bookmaker: true,
          result: true,
          receivedAt: true,
          group: { select: { name: true } },
          takes: { where: { userId }, select: { takenStatus: true, unit: true, odd: true, bookmaker: true, bonusReais: true } },
        },
      }),
      // Tips já marcadas "peguei" cujo resultado oficial ainda não saiu —
      // dinheiro travado que `rows` (result != pending) nunca enxerga. Sem
      // filtro de `since`: uma aposta em aberto conta agora, não quando a
      // tip chegou.
      prisma.telegramTipTake.findMany({
        where: { userId, takenStatus: "taken", tip: { is: { result: "pending" } } },
        select: { unit: true, bookmaker: true, tip: { select: { unit: true, bookmaker: true } } },
      }),
      prisma.telegramBancaSettings.findUnique({ where: { userId } }),
    ]);
    const unitValue = settings?.unitValue !== null && settings?.unitValue !== undefined ? Number(settings.unitValue) : null;

    const source: BancaSourceRow[] = rows
      .filter((r) => matchesBookmaker(r.bookmaker))
      .map((r) => ({
        unit: r.unit,
        odd: r.odd,
        bookmaker: r.bookmaker,
        result: r.result,
        groupName: r.group.name,
        receivedAt: r.receivedAt,
        bonusReais: 0,
      }));
    const taken: BancaSourceRow[] = rows
      .filter((r) => r.takes[0]?.takenStatus === "taken" && matchesBookmaker(r.takes[0].bookmaker ?? r.bookmaker))
      .map((r) => {
        const mine = r.takes[0]!;
        // Mesmo fallback pro valor oficial da tip quando o take não tem o
        // próprio (unit/odd/bookmaker nulos) já usado no card de
        // apps/web/src/app/telegram-tips/TelegramTipsPage.tsx:204 ("tip.mine.unit
        // ?? tip.unit") e nos openTakes logo acima — sem isso, uma aposta tomada
        // sem edição manual (unit/casa herdados da tip oficial) sumia da tabela
        // "Casas de apostas" do perfil (ROI "-", grupo errado) mesmo aparecendo
        // certinha em toda outra tela.
        return {
          unit: mine.unit ?? r.unit,
          odd: mine.odd ?? r.odd,
          bookmaker: mine.bookmaker ?? r.bookmaker,
          result: r.result,
          groupName: r.group.name,
          receivedAt: r.receivedAt,
          bonusReais: mine.bonusReais !== null ? Number(mine.bonusReais) : 0,
        };
      });

    // Uma linha só somando tudo (independente de grupo/casa) — alimenta o
    // "Banca Atual" do perfil: Banca Inicial (saldo depositado) + lucro em
    // unidades das tips que o usuário realmente pegou.
    const totalRow = (rows: BancaSourceRow[]) => aggregateBy(rows, () => "total", unitValue)[0] ?? null;

    const openUnits = openTakes
      .filter((t) => matchesBookmaker(t.bookmaker ?? t.tip.bookmaker))
      .reduce((sum, t) => sum + Number(t.unit ?? t.tip.unit ?? 0), 0);

    return {
      geral: {
        byGroup: aggregateBy(source, (r) => r.groupName, unitValue),
        byBookmaker: aggregateBy(source, (r) => r.bookmaker, unitValue),
      },
      peguei: {
        byGroup: aggregateBy(taken, (r) => r.groupName, unitValue),
        byBookmaker: aggregateBy(taken, (r) => r.bookmaker, unitValue),
      },
      totals: { geral: totalRow(source), peguei: totalRow(taken) },
      series: { geral: series(source, unitValue), peguei: series(taken, unitValue) },
      aberto: {
        count: openTakes.filter((t) => matchesBookmaker(t.bookmaker ?? t.tip.bookmaker)).length,
        units: Math.round(openUnits * 100) / 100,
        unitsBRL: unitValue !== null ? Math.round(openUnits * unitValue * 100) / 100 : null,
      },
    };
  });

  // ── Configurações pessoais (unidade em R$ + saldo por casa) ─────────────
  app.get("/settings", async (request): Promise<TelegramBancaSettings> => {
    const settings = await prisma.telegramBancaSettings.findUnique({ where: { userId: request.authUser!.id } });
    return {
      unitValue: settings?.unitValue !== null && settings?.unitValue !== undefined ? Number(settings.unitValue) : null,
      bookmakerColors: (settings?.bookmakerColors as Record<string, string> | null) ?? null,
    };
  });

  app.put("/settings", async (request, reply): Promise<TelegramBancaSettings> => {
    const parsed = UpdateTelegramBancaSettingsInput.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_input", details: parsed.error.flatten() }) as never;
    }
    const settings = await prisma.telegramBancaSettings.upsert({
      where: { userId: request.authUser!.id },
      create: {
        userId: request.authUser!.id,
        unitValue: parsed.data.unitValue,
        ...(parsed.data.bookmakerColors !== undefined ? { bookmakerColors: parsed.data.bookmakerColors ?? {} } : {}),
      },
      update: {
        unitValue: parsed.data.unitValue,
        ...(parsed.data.bookmakerColors !== undefined ? { bookmakerColors: parsed.data.bookmakerColors ?? {} } : {}),
      },
    });
    return {
      unitValue: settings.unitValue !== null ? Number(settings.unitValue) : null,
      bookmakerColors: (settings.bookmakerColors as Record<string, string> | null) ?? null,
    };
  });

  app.get("/bookmaker-balances", async (request): Promise<TelegramBookmakerBalance[]> => {
    const rows = await prisma.telegramBookmakerBalance.findMany({
      where: { userId: request.authUser!.id },
      orderBy: { bookmaker: "asc" },
    });
    return rows.map((r) => ({ bookmaker: r.bookmaker, balance: Number(r.balance) }));
  });

  /** Substitui a lista inteira — poucas linhas, baixa frequência de escrita, não precisa de CRUD por linha. */
  app.put("/bookmaker-balances", async (request, reply): Promise<TelegramBookmakerBalance[]> => {
    const parsed = UpdateTelegramBookmakerBalancesInput.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_input", details: parsed.error.flatten() }) as never;
    }
    const userId = request.authUser!.id;
    await prisma.$transaction([
      prisma.telegramBookmakerBalance.deleteMany({ where: { userId } }),
      ...parsed.data.map((row) =>
        prisma.telegramBookmakerBalance.create({ data: { userId, bookmaker: row.bookmaker, balance: row.balance } }),
      ),
    ]);
    return parsed.data;
  });

  app.get("/withdrawals", async (request): Promise<TelegramBookmakerWithdrawal[]> => {
    const rows = await prisma.telegramBookmakerWithdrawal.findMany({
      where: { userId: request.authUser!.id },
      orderBy: [{ withdrawnAt: "desc" }, { createdAt: "desc" }],
    });
    return rows.map(withdrawalView);
  });

  app.post("/withdrawals", async (request, reply) => {
    const parsed = CreateTelegramBookmakerWithdrawalInput.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_input", details: parsed.error.flatten() });
    const withdrawnAt = new Date(`${parsed.data.withdrawnAt}T00:00:00Z`);
    if (Number.isNaN(withdrawnAt.getTime())) return reply.code(400).send({ error: "invalid_date" });
    const row = await prisma.telegramBookmakerWithdrawal.create({
      data: { userId: request.authUser!.id, bookmaker: parsed.data.bookmaker, amount: parsed.data.amount, withdrawnAt },
    });
    return reply.code(201).send(withdrawalView(row));
  });

  app.delete<{ Params: { id: string } }>("/withdrawals/:id", async (request, reply) => {
    const { count } = await prisma.telegramBookmakerWithdrawal.deleteMany({ where: { id: request.params.id, userId: request.authUser!.id } });
    if (count === 0) return reply.code(404).send({ error: "not_found" });
    return reply.code(204).send();
  });
}

function withdrawalView(r: { id: string; bookmaker: string; amount: Prisma.Decimal; withdrawnAt: Date }): TelegramBookmakerWithdrawal {
  return { id: r.id, bookmaker: r.bookmaker, amount: Number(r.amount), withdrawnAt: r.withdrawnAt.toISOString().slice(0, 10) };
}
