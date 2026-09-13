import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import {
  CreateTelegramGroupInput,
  UpdateTelegramGroupInput,
  UpdateTelegramTipInput,
  UpdateTelegramTipTakeInput,
  UpdateTelegramBancaSettingsInput,
  UpdateTelegramBookmakerBalancesInput,
  type TelegramTip,
  type TelegramBancaRow,
  type TelegramBancaSettings,
  type TelegramBookmakerBalance,
} from "@evobo/shared-types";
import { authGuard } from "../../middleware/authGuard.js";
import { roleGuard } from "../../middleware/roleGuard.js";
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
  select: { takenStatus: true; unit: true; odd: true; bookmaker: true; betUrl: true };
}>;

/** Batch-fetches the current user's own TelegramTipTake for each tip id,
 * keyed by tipId — a tip with no row yet just isn't in the map (serializeTip
 * defaults it to pending/nulls). Same batching shape as resolvePhotoUrls. */
async function fetchMyTakes(tipIds: string[], userId: string): Promise<Map<string, TipTakeRow>> {
  if (tipIds.length === 0) return new Map();
  const rows = await prisma.telegramTipTake.findMany({
    where: { tipId: { in: tipIds }, userId },
    select: { tipId: true, takenStatus: true, unit: true, odd: true, bookmaker: true, betUrl: true },
  });
  return new Map(rows.map((r) => [r.tipId, r]));
}

function serializeTip(tip: TipWithGroup, photoUrls: Map<string, string>, myTake: TipTakeRow | undefined): TelegramTip {
  return {
    id: tip.id,
    groupId: tip.groupId,
    groupName: tip.group.name,
    telegramMessageId: tip.telegramMessageId.toString(),
    match: tip.match,
    selection: tip.selection,
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
function buildScopeWhere(query: { groupId?: string; bookmaker?: string; search?: string; dateFrom?: string; dateTo?: string }): Prisma.TelegramTipWhereInput {
  const { groupId, bookmaker, search, dateFrom, dateTo } = query;
  const groupIds = groupId ? groupId.split(",").filter(Boolean) : [];
  // dateTo é inclusivo — o corte real é o início do dia seguinte.
  const untilExclusive = dateTo ? new Date(startOfSpDay(dateTo).getTime() + 24 * 60 * 60 * 1000) : null;

  return {
    ...(groupIds.length === 1 ? { groupId: groupIds[0] } : groupIds.length > 1 ? { groupId: { in: groupIds } } : {}),
    ...(bookmaker ? { bookmaker } : {}),
    ...(search ? { OR: [{ match: { contains: search, mode: "insensitive" } }, { selection: { contains: search, mode: "insensitive" } }] } : {}),
    ...(dateFrom || untilExclusive
      ? { receivedAt: { ...(dateFrom ? { gte: startOfSpDay(dateFrom) } : {}), ...(untilExclusive ? { lt: untilExclusive } : {}) } }
      : {}),
  };
}

/** green: stake × (odd − 1); red: −stake; reembolso: 0 — same convention robot-signals/routes.ts uses. */
function tipProfit(unit: number, odd: number | null, result: string): number | null {
  if (result === "green") return odd ? unit * (odd - 1) : null;
  if (result === "red") return -unit;
  if (result === "reembolso") return 0;
  return null;
}

type BancaSourceRow = {
  unit: Prisma.Decimal | null;
  odd: Prisma.Decimal | null;
  bookmaker: string | null;
  groupName: string;
  result: string;
  receivedAt: Date;
};

/** Cumulative profit in units, chronological by receivedAt — feeds the
 * "Evolução da banca" chart on the report page. Tips with a result but no
 * odd (missingOdd) contribute 0, same as they're excluded from `profit`
 * in aggregateBy. */
function series(rows: BancaSourceRow[]): { t: string; profit: number }[] {
  let cumulative = 0;
  return [...rows]
    .sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime())
    .map((r) => {
      const unit = r.unit !== null ? Number(r.unit) : 0;
      const odd = r.odd !== null ? Number(r.odd) : null;
      cumulative += tipProfit(unit, odd, r.result) ?? 0;
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
    if (r.result === "green") g.green++;
    else if (r.result === "red") g.red++;
    else if (r.result === "reembolso") g.reembolso++;

    const unit = r.unit !== null ? Number(r.unit) : 0;
    const odd = r.odd !== null ? Number(r.odd) : null;
    if (r.result !== "reembolso") g.staked += unit;
    const pl = tipProfit(unit, odd, r.result);
    if (pl === null) g.missingOdd++;
    else g.profit += pl;
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
  // no perfil, pra digitar sempre o mesmo nome ("betano" vs "Betano").
  app.get("/bookmakers", async (): Promise<string[]> => {
    const rows = await prisma.telegramTip.findMany({
      where: { bookmaker: { not: null } },
      select: { bookmaker: true },
      distinct: ["bookmaker"],
    });
    return rows.map((r) => r.bookmaker!).sort((a, b) => a.localeCompare(b));
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
  app.patch<{ Params: { name: string }; Body: { name?: string } }>("/bookmakers/:name", async (request, reply) => {
    if (request.authUser!.roleName !== "admin") return reply.code(403).send({ error: "forbidden" });
    const oldName = request.params.name;
    const newName = request.body?.name?.trim();
    if (!newName) return reply.code(400).send({ error: "invalid_input", details: "name is required" });
    if (newName === oldName) return { renamed: 0 };

    const { count } = await prisma.telegramTip.updateMany({ where: { bookmaker: oldName }, data: { bookmaker: newName } });
    await rewriteBookmakerOptions(oldName, newName);

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

    return { cleared: count };
  });

  // ── Grupos rastreados ──────────────────────────────────────────────────
  app.get("/groups", async () => {
    return prisma.telegramGroup.findMany({ orderBy: { name: "asc" } });
  });

  app.post("/groups", async (request, reply) => {
    const parsed = CreateTelegramGroupInput.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_input", details: parsed.error.flatten() });
    }
    const group = await prisma.telegramGroup.create({ data: parsed.data });
    return reply.code(201).send(group);
  });

  app.patch<{ Params: { id: string } }>("/groups/:id", async (request, reply) => {
    const parsed = UpdateTelegramGroupInput.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_input", details: parsed.error.flatten() });
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
      result?: string;
      takenStatus?: string;
      search?: string;
      dateFrom?: string;
      dateTo?: string;
      /** Comma list of "odd"|"unit"|"match"|"bookmaker" — tips missing ANY of
       * these (OR'd together) — the Admin "Tips oficiais" screen's audit
       * filters (odd/jogo/casa/unidade faltando). */
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

    // takenStatus agora é por usuário — filtra pela relação, nunca por uma
    // coluna na própria tip (essa coluna não existe mais, ver TelegramTipTake).
    const takenFilter: Prisma.TelegramTipWhereInput =
      takenStatus === "pending"
        ? { takes: { none: { userId, takenStatus: { in: ["taken", "skipped"] } } } }
        : takenStatus === "taken" || takenStatus === "skipped"
          ? { takes: { some: { userId, takenStatus } } }
          : {};

    const missingFields = missing ? missing.split(",").filter(Boolean) : [];
    const missingFilter: Prisma.TelegramTipWhereInput =
      missingFields.length > 0
        ? {
            OR: missingFields
              .map((f) => (f === "odd" || f === "unit" || f === "match" || f === "bookmaker" ? { [f]: null } : null))
              .filter((f): f is { [key: string]: null } => f !== null),
          }
        : {};

    const where: Prisma.TelegramTipWhereInput = {
      ...buildScopeWhere(request.query),
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

  // Números dos cards do topo (Tips pendentes / Peguei / Resultado) —
  // recebe o mesmo grupo/casa/busca/período da lista acima (nunca
  // result/takenStatus: cada número já força o critério dele, senão
  // "pendentes" ou "peguei" sempre voltariam 0 assim que o usuário troca de
  // aba de resultado ou do dropdown Peguei/Não peguei).
  app.get<{
    Querystring: { groupId?: string; bookmaker?: string; search?: string; dateFrom?: string; dateTo?: string };
  }>("/summary", async (request) => {
    const scope = buildScopeWhere(request.query);
    const userId = request.authUser!.id;

    const [pendingCount, taken] = await Promise.all([
      prisma.telegramTip.count({ where: { ...scope, takes: { none: { userId, takenStatus: { in: ["taken", "skipped"] } } } } }),
      prisma.telegramTip.findMany({
        where: { ...scope, takes: { some: { userId, takenStatus: "taken" } } },
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

  // Corrige o registro OFICIAL da tip (odd/unidade/casa/link/mercado/jogo/
  // resultado) — o que o tipster falou de verdade e como resolveu, igual
  // pra todo mundo. Editável só pelo admin (tela /admin/telegram-tips);
  // acompanhamento pessoal (peguei/não peguei + minha unidade/odd/casa) é
  // outro endpoint, ver PATCH /:id/take.
  app.patch<{ Params: { id: string } }>("/:id", async (request, reply) => {
    if (request.authUser!.roleName !== "admin") return reply.code(403).send({ error: "forbidden" });
    const parsed = UpdateTelegramTipInput.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_input", details: parsed.error.flatten() });
    }
    const input = parsed.data;

    const tip = await prisma.telegramTip.update({
      where: { id: request.params.id },
      data: {
        // Gradar manualmente resolve qualquer "precisa revisar" que o
        // auto-grader diário do bet-analytix tenha deixado pra essa tip.
        ...(input.result !== undefined ? { result: input.result, needsReview: false } : {}),
        ...(input.unit !== undefined ? { unit: input.unit } : {}),
        ...(input.selection !== undefined ? { selection: input.selection } : {}),
        ...(input.match !== undefined ? { match: input.match } : {}),
        ...(input.bookmaker !== undefined ? { bookmaker: input.bookmaker } : {}),
        ...(input.betUrl !== undefined ? { betUrl: input.betUrl } : {}),
        ...(input.odd !== undefined ? { odd: input.odd, oddSource: input.odd !== null ? "manual" : null } : {}),
      },
      include: { group: { select: { name: true } } },
    });

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

    await prisma.telegramTipTake.upsert({
      where: { tipId_userId: { tipId, userId } },
      create: { tipId, userId, ...input },
      update: input,
    });

    const tip = await prisma.telegramTip.findUniqueOrThrow({
      where: { id: tipId },
      include: { group: { select: { name: true } } },
    });
    const [photoUrls, myTakes] = await Promise.all([resolvePhotoUrls([tip.photoPath]), fetchMyTakes([tipId], userId)]);
    return serializeTip(tip, photoUrls, myTakes.get(tipId));
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

  // ── Gestão de banca ───────────────────────────────────────────────────
  // "geral" = todas as tips resolvidas com o registro OFICIAL (mede o
  // grupo/tipster, igual pra todo mundo); "peguei" = só as que este usuário
  // marcou como tomadas, com a unidade/odd/casa PESSOAIS dele — pode diferir
  // do oficial (stake menor, casa diferente etc.). result sempre é oficial
  // nos dois (é um fato objetivo, não uma escolha pessoal).
  app.get<{ Querystring: { bookmaker?: string; days?: string } }>("/banca", async (request) => {
    const bookmaker = request.query.bookmaker?.trim();
    const userId = request.authUser!.id;
    // "7" | "30" | "90" | absent/"all" — scopes the whole summary (chart,
    // totals, breakdowns) to tips received in that window.
    const days = request.query.days ? Number(request.query.days) : null;
    const since = days && Number.isFinite(days) && days > 0 ? new Date(Date.now() - days * 24 * 60 * 60 * 1000) : null;
    const [rows, settings] = await Promise.all([
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
          takes: { where: { userId }, select: { takenStatus: true, unit: true, odd: true, bookmaker: true } },
        },
      }),
      prisma.telegramBancaSettings.findUnique({ where: { userId } }),
    ]);
    const unitValue = settings?.unitValue !== null && settings?.unitValue !== undefined ? Number(settings.unitValue) : null;

    const source: BancaSourceRow[] = rows
      .filter((r) => !bookmaker || r.bookmaker === bookmaker)
      .map((r) => ({
        unit: r.unit,
        odd: r.odd,
        bookmaker: r.bookmaker,
        result: r.result,
        groupName: r.group.name,
        receivedAt: r.receivedAt,
      }));
    const taken: BancaSourceRow[] = rows
      .filter((r) => r.takes[0]?.takenStatus === "taken" && (!bookmaker || r.takes[0].bookmaker === bookmaker))
      .map((r) => {
        const mine = r.takes[0]!;
        return {
          unit: mine.unit,
          odd: mine.odd,
          bookmaker: mine.bookmaker,
          result: r.result,
          groupName: r.group.name,
          receivedAt: r.receivedAt,
        };
      });

    // Uma linha só somando tudo (independente de grupo/casa) — alimenta o
    // "Banca Atual" do perfil: Banca Inicial (saldo depositado) + lucro em
    // unidades das tips que o usuário realmente pegou.
    const totalRow = (rows: BancaSourceRow[]) => aggregateBy(rows, () => "total", unitValue)[0] ?? null;

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
      series: { geral: series(source), peguei: series(taken) },
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
}
