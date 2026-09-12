import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import {
  CreateTelegramGroupInput,
  UpdateTelegramGroupInput,
  UpdateTelegramTipInput,
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

function serializeTip(tip: TipWithGroup, photoUrls: Map<string, string>): TelegramTip {
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
    takenStatus: tip.takenStatus as TelegramTip["takenStatus"],
    parsePattern: tip.parsePattern,
    receivedAt: tip.receivedAt.toISOString(),
    rawMessage: tip.rawMessage,
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
  takenStatus: string;
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
    };
  }>("/", async (request) => {
    const page = Math.max(1, parseInt(request.query.page ?? "1", 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(request.query.limit ?? "20", 10) || 20));
    const { groupId, bookmaker, result, takenStatus, search } = request.query;
    // groupId accepts a comma-separated list so the UI can filter by 2+ groups at once.
    const groupIds = groupId ? groupId.split(",").filter(Boolean) : [];

    const where: Prisma.TelegramTipWhereInput = {
      ...(groupIds.length === 1 ? { groupId: groupIds[0] } : groupIds.length > 1 ? { groupId: { in: groupIds } } : {}),
      ...(bookmaker ? { bookmaker } : {}),
      ...(result ? { result } : {}),
      ...(takenStatus ? { takenStatus } : {}),
      ...(search ? { OR: [{ match: { contains: search, mode: "insensitive" } }, { selection: { contains: search, mode: "insensitive" } }] } : {}),
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

    const photoUrls = await resolvePhotoUrls(rows.map((r) => r.photoPath));

    return {
      data: rows.map((r) => serializeTip(r, photoUrls)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  });

  app.patch<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const parsed = UpdateTelegramTipInput.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_input", details: parsed.error.flatten() });
    }
    const input = parsed.data;

    // Grading a tip's result affects everyone else's read of the group/
    // tipster performance (GET /banca's "geral" scope) — reserved for admin,
    // unlike takenStatus/manual corrections which are per-user judgment calls.
    if (input.result !== undefined && request.authUser!.roleName !== "admin") {
      return reply.code(403).send({ error: "forbidden", field: "result" });
    }

    const tip = await prisma.telegramTip.update({
      where: { id: request.params.id },
      data: {
        ...(input.result !== undefined ? { result: input.result } : {}),
        ...(input.takenStatus !== undefined ? { takenStatus: input.takenStatus } : {}),
        ...(input.unit !== undefined ? { unit: input.unit } : {}),
        ...(input.selection !== undefined ? { selection: input.selection } : {}),
        ...(input.match !== undefined ? { match: input.match } : {}),
        ...(input.bookmaker !== undefined ? { bookmaker: input.bookmaker } : {}),
        ...(input.betUrl !== undefined ? { betUrl: input.betUrl } : {}),
        ...(input.odd !== undefined ? { odd: input.odd, oddSource: input.odd !== null ? "manual" : null } : {}),
      },
      include: { group: { select: { name: true } } },
    });

    const photoUrls = await resolvePhotoUrls([tip.photoPath]);
    return serializeTip(tip, photoUrls);
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

  // Cabeçalho do dashboard "VIP Telegram" — backlog de decisão (pendentes,
  // sem recorte de data) + atividade só de hoje (fuso São Paulo, fixo em
  // UTC-3 o ano todo desde 2019).
  app.get("/today-summary", async () => {
    const todayIso = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
    const [y, m, d] = todayIso.split("-").map(Number);
    const startOfToday = new Date(Date.UTC(y!, m! - 1, d!, 3, 0, 0));

    const [pendingCount, takenToday] = await Promise.all([
      prisma.telegramTip.count({ where: { takenStatus: "pending" } }),
      prisma.telegramTip.findMany({
        where: { takenStatus: "taken", receivedAt: { gte: startOfToday } },
        select: { unit: true, odd: true, result: true },
      }),
    ]);

    let takenTodayUnits = 0;
    let resultTodayUnits = 0;
    for (const t of takenToday) {
      const unit = t.unit !== null ? Number(t.unit) : 0;
      takenTodayUnits += unit;
      const odd = t.odd !== null ? Number(t.odd) : null;
      resultTodayUnits += tipProfit(unit, odd, t.result) ?? 0;
    }

    return {
      pendingCount,
      takenTodayCount: takenToday.length,
      takenTodayUnits: Math.round(takenTodayUnits * 100) / 100,
      resultTodayUnits: Math.round(resultTodayUnits * 100) / 100,
    };
  });

  // ── Gestão de banca ───────────────────────────────────────────────────
  // "geral" = todas as tips resolvidas, independente de terem sido apostadas
  // de fato (mede o grupo/tipster); "peguei" = só as marcadas como
  // takenStatus "taken" (mede o resultado real do usuário).
  app.get<{ Querystring: { bookmaker?: string; days?: string } }>("/banca", async (request) => {
    const bookmaker = request.query.bookmaker?.trim();
    // "7" | "30" | "90" | absent/"all" — scopes the whole summary (chart,
    // totals, breakdowns) to tips received in that window.
    const days = request.query.days ? Number(request.query.days) : null;
    const since = days && Number.isFinite(days) && days > 0 ? new Date(Date.now() - days * 24 * 60 * 60 * 1000) : null;
    const [rows, settings] = await Promise.all([
      prisma.telegramTip.findMany({
        where: {
          result: { not: "pending" },
          ...(bookmaker ? { bookmaker } : {}),
          ...(since ? { receivedAt: { gte: since } } : {}),
        },
        select: {
          unit: true,
          odd: true,
          bookmaker: true,
          result: true,
          takenStatus: true,
          receivedAt: true,
          group: { select: { name: true } },
        },
      }),
      prisma.telegramBancaSettings.findUnique({ where: { userId: request.authUser!.id } }),
    ]);
    const unitValue = settings?.unitValue !== null && settings?.unitValue !== undefined ? Number(settings.unitValue) : null;

    const source: BancaSourceRow[] = rows.map((r) => ({
      unit: r.unit,
      odd: r.odd,
      bookmaker: r.bookmaker,
      result: r.result,
      takenStatus: r.takenStatus,
      groupName: r.group.name,
      receivedAt: r.receivedAt,
    }));
    const taken = source.filter((r) => r.takenStatus === "taken");

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
