import { z } from "zod";

/** The 15 product screens + admin sub-screens, used as role_screen_access.screen_key. */
export const screenKeys = [
  "feed",
  "ao_vivo",
  "ev_plus",
  "ranking",
  "jogos",
  "busca",
  "tip_aberta",
  "analise_ia",
  "grupo_vip",
  "checkout",
  "meu_perfil",
  "perfil",
  "nova_tip",
  "robo_apostas",
  "telegram_banca",
  "admin",
  "admin_roles",
  "admin_payments",
  "admin_screens",
] as const;
export const ScreenKey = z.enum(screenKeys);
export type ScreenKey = z.infer<typeof ScreenKey>;

/** "vip" screens only enter a user's accessibleScreens if they hold an active VipSubscription to any group. */
export const ScreenTier = z.enum(["free", "vip"]);
export type ScreenTier = z.infer<typeof ScreenTier>;

export const RoleSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  description: z.string().nullable(),
  isSystem: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Role = z.infer<typeof RoleSchema>;

export const CreateRoleInput = z.object({
  name: z
    .string()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9_]+$/, "use lowercase letters, numbers, underscore"),
  description: z.string().max(200).optional(),
});
export type CreateRoleInput = z.infer<typeof CreateRoleInput>;

export const UpdateRoleInput = z.object({
  description: z.string().max(200).optional(),
});
export type UpdateRoleInput = z.infer<typeof UpdateRoleInput>;

export const UpdateRoleScreenAccessInput = z.object({
  screens: z.array(ScreenKey),
});
export type UpdateRoleScreenAccessInput = z.infer<typeof UpdateRoleScreenAccessInput>;

export const RoleScreenAccessByTier = z.object({
  free: z.array(ScreenKey),
  vip: z.array(ScreenKey),
});
export type RoleScreenAccessByTier = z.infer<typeof RoleScreenAccessByTier>;

export const AssignRoleInput = z.object({
  userId: z.string().uuid(),
  roleId: z.string().uuid(),
});
export type AssignRoleInput = z.infer<typeof AssignRoleInput>;

export const UpdateOwnProfileInput = z.object({
  displayName: z.string().min(1).max(60).optional(),
  // Lowercase letters/digits only, matching the handle_new_user() DB trigger
  // that generates the initial username (see users/routes.ts PATCH /me).
  username: z.string().min(3).max(30).regex(/^[a-z0-9]+$/).optional(),
  avatarUrl: z.string().url().nullable().optional(),
  bio: z.string().max(280).nullable().optional(),
  favoriteSports: z.array(z.string().min(1).max(30)).max(10).optional(),
});
export type UpdateOwnProfileInput = z.infer<typeof UpdateOwnProfileInput>;

export const UserSchema = z.object({
  id: z.string().uuid(),
  username: z.string().min(3).max(30),
  displayName: z.string().min(1).max(60),
  avatarUrl: z.string().url().nullable(),
  bio: z.string().max(280).nullable(),
  favoriteSports: z.array(z.string()),
  roleId: z.string().uuid(),
  verifiedAt: z.string().nullable(),
  verifiedBadgeReason: z.string().nullable(),
  isActive: z.boolean(),
  lastLoginAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type User = z.infer<typeof UserSchema>;

export const GameStatus = z.enum(["scheduled", "live", "finished"]);
export const GameSchema = z.object({
  id: z.string().uuid(),
  externalId: z.string().nullable(),
  homeTeam: z.string(),
  awayTeam: z.string(),
  league: z.string(),
  startsAt: z.string(),
  status: GameStatus,
  scoreHome: z.number().int().nullable(),
  scoreAway: z.number().int().nullable(),
});
export type Game = z.infer<typeof GameSchema>;

export const CreateGameInput = z.object({
  homeTeam: z.string().min(1).max(80),
  awayTeam: z.string().min(1).max(80),
  league: z.string().min(1).max(80),
  startsAt: z.string(),
});
export type CreateGameInput = z.infer<typeof CreateGameInput>;

/** No external live-sports provider is wired up yet — scores/status are updated manually until one is. */
export const UpdateGameInput = z.object({
  status: GameStatus.optional(),
  scoreHome: z.number().int().min(0).nullable().optional(),
  scoreAway: z.number().int().min(0).nullable().optional(),
});
export type UpdateGameInput = z.infer<typeof UpdateGameInput>;

export const TipStatus = z.enum(["pending", "green", "red", "void"]);
export const TipVisibility = z.enum(["public", "vip_only"]);
export const TipConfidence = z.enum(["baixa", "media", "alta"]);

export const TipSchema = z.object({
  id: z.string().uuid(),
  authorId: z.string().uuid(),
  matchId: z.string().uuid(),
  market: z.string().min(1).max(140),
  odds: z.coerce.number().positive(),
  stakeUnits: z.coerce.number().positive().max(10),
  // Holds the bet link (e.g. "https://bet365.com/..."), not a bookmaker name —
  // free-text so tips can point at bookmakers that aren't in any fixed list.
  house: z.string().min(1).max(500),
  confidence: TipConfidence.nullable(),
  analysisText: z.string().max(2000).nullable(),
  imageUrl: z.string().url().nullable(),
  status: TipStatus,
  resultSettledAt: z.string().nullable(),
  visibility: TipVisibility,
  vipGroupId: z.string().uuid().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Tip = z.infer<typeof TipSchema>;

export const CreateTipInput = TipSchema.pick({
  matchId: true,
  market: true,
  odds: true,
  stakeUnits: true,
  house: true,
  confidence: true,
  analysisText: true,
  imageUrl: true,
  visibility: true,
  vipGroupId: true,
}).partial({ confidence: true, analysisText: true, imageUrl: true, vipGroupId: true });
export type CreateTipInput = z.infer<typeof CreateTipInput>;

export const BillingPeriod = z.enum(["monthly", "quarterly", "yearly"]);

export const VipGroupSchema = z.object({
  id: z.string().uuid(),
  ownerId: z.string().uuid(),
  name: z.string().min(1).max(80),
  description: z.string().max(500).nullable(),
  price: z.coerce.number().positive(),
  currency: z.literal("BRL"),
  billingPeriod: BillingPeriod,
  createdAt: z.string(),
});
export type VipGroup = z.infer<typeof VipGroupSchema>;

export const VipSubscriptionStatus = z.enum(["active", "expired", "canceled"]);
export const VipSubscriptionSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  vipGroupId: z.string().uuid(),
  status: VipSubscriptionStatus,
  startedAt: z.string(),
  expiresAt: z.string(),
});
export type VipSubscription = z.infer<typeof VipSubscriptionSchema>;

/** Manual Pix reconciliation — no PSP. See project memory "payments-manual-pix". */
export const PaymentStatus = z.enum([
  "awaiting_proof",
  "pending_review",
  "approved",
  "rejected",
]);
export const PaymentSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  vipGroupId: z.string().uuid(),
  vipSubscriptionId: z.string().uuid().nullable(),
  billingPeriod: BillingPeriod,
  amount: z.coerce.number().positive(),
  currency: z.literal("BRL"),
  method: z.literal("pix_manual"),
  qrCodePayload: z.string().min(1),
  proofImageUrl: z.string().url().nullable(),
  status: PaymentStatus,
  reviewedBy: z.string().uuid().nullable(),
  reviewedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Payment = z.infer<typeof PaymentSchema>;

export const CreatePaymentInput = z.object({
  vipGroupId: z.string().uuid(),
  billingPeriod: BillingPeriod,
});
export type CreatePaymentInput = z.infer<typeof CreatePaymentInput>;

export const CommentSchema = z.object({
  id: z.string().uuid(),
  tipId: z.string().uuid(),
  authorId: z.string().uuid(),
  content: z.string().min(1).max(1000),
  isDeleted: z.boolean(),
  createdAt: z.string(),
});
export type Comment = z.infer<typeof CommentSchema>;

export const CreateCommentInput = z.object({
  content: z.string().min(1).max(1000),
});
export type CreateCommentInput = z.infer<typeof CreateCommentInput>;

export const NotificationSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  type: z.string(),
  payload: z.record(z.string(), z.unknown()),
  readAt: z.string().nullable(),
  createdAt: z.string(),
});
export type Notification = z.infer<typeof NotificationSchema>;

export const FollowSchema = z.object({
  followerId: z.string().uuid(),
  followedId: z.string().uuid(),
  createdAt: z.string(),
});
export type Follow = z.infer<typeof FollowSchema>;

export const AuditLogSchema = z.object({
  id: z.string().uuid(),
  actorId: z.string().uuid().nullable(),
  action: z.string(),
  targetType: z.string(),
  targetId: z.string().uuid().nullable(),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
});
export type AuditLog = z.infer<typeof AuditLogSchema>;

// ── Banca Telegram (personal tip tracker, apps/worker + telegram-tips module) ──

export const TelegramGroupSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  telegramChatId: z.string(),
  active: z.boolean(),
  createdAt: z.string(),
});
export type TelegramGroup = z.infer<typeof TelegramGroupSchema>;

export const CreateTelegramGroupInput = z.object({
  name: z.string().min(1).max(120),
  telegramChatId: z.string().min(1),
});
export type CreateTelegramGroupInput = z.infer<typeof CreateTelegramGroupInput>;

export const UpdateTelegramGroupInput = z.object({
  name: z.string().min(1).max(120).optional(),
  active: z.boolean().optional(),
});
export type UpdateTelegramGroupInput = z.infer<typeof UpdateTelegramGroupInput>;

export const TelegramTipResult = z.enum(["pending", "green", "red", "reembolso"]);
export type TelegramTipResult = z.infer<typeof TelegramTipResult>;

/** Whether the user actually placed this bet. Set manually on the dashboard
 * for now — reading the user's own 👍 reaction on Telegram to set "taken"
 * automatically is future work, not built yet. */
export const TelegramTipTakenStatus = z.enum(["pending", "taken", "skipped"]);
export type TelegramTipTakenStatus = z.infer<typeof TelegramTipTakenStatus>;

export const TelegramTipSchema = z.object({
  id: z.string().uuid(),
  groupId: z.string().uuid(),
  groupName: z.string(),
  telegramMessageId: z.string(),
  match: z.string().nullable(),
  /** Null on old resolved tips whose detail was purged for storage cost — see TelegramTip in schema.prisma. */
  selection: z.string().nullable(),
  unit: z.number().nullable(),
  odd: z.number().nullable(),
  /** "ocr" | "manual" | "text" (already explicit in the Telegram message body). */
  oddSource: z.enum(["ocr", "manual", "text"]).nullable(),
  bookmaker: z.string().nullable(),
  betUrl: z.string().nullable(),
  photoUrl: z.string().nullable(),
  result: TelegramTipResult,
  takenStatus: TelegramTipTakenStatus,
  /** Which worker parser matcher recognized the message — null means nothing
   * matched and every extractable field still needs a manual look. */
  parsePattern: z.string().nullable(),
  receivedAt: z.string(),
  rawMessage: z.string().nullable(),
});
export type TelegramTip = z.infer<typeof TelegramTipSchema>;

/** Manual correction from the dashboard — always available as the OCR/parser fallback. */
export const UpdateTelegramTipInput = z.object({
  result: TelegramTipResult.optional(),
  takenStatus: TelegramTipTakenStatus.optional(),
  odd: z.number().positive().nullable().optional(),
  unit: z.number().positive().nullable().optional(),
  selection: z.string().min(1).max(200).optional(),
  match: z.string().max(200).nullable().optional(),
  bookmaker: z.string().max(80).nullable().optional(),
  betUrl: z.string().url().nullable().optional(),
});
export type UpdateTelegramTipInput = z.infer<typeof UpdateTelegramTipInput>;

export const TelegramBancaRow = z.object({
  key: z.string(),
  total: z.number(),
  green: z.number(),
  red: z.number(),
  reembolso: z.number(),
  staked: z.number(),
  profit: z.number(),
  roiPct: z.number().nullable(),
  greenPct: z.number().nullable(),
  missingOdd: z.number(),
  /** staked/profit converted to R$ using the user's registered unit value — null when unset. */
  stakedBRL: z.number().nullable(),
  profitBRL: z.number().nullable(),
});
export type TelegramBancaRow = z.infer<typeof TelegramBancaRow>;

const TelegramBancaScope = z.object({
  byGroup: z.array(TelegramBancaRow),
  byBookmaker: z.array(TelegramBancaRow),
});

/** "geral" = every resolved tip regardless of takenStatus (how good the group's calls are);
 * "peguei" = only the ones the user marked as taken (the user's real P&L). */
export const TelegramBancaSummary = z.object({
  geral: TelegramBancaScope,
  peguei: TelegramBancaScope,
  /** One row summing everything (no group/bookmaker split) — feeds "Banca Atual" on the profile. */
  totals: z.object({ geral: TelegramBancaRow.nullable(), peguei: TelegramBancaRow.nullable() }),
});
export type TelegramBancaSummary = z.infer<typeof TelegramBancaSummary>;

export const TelegramBancaSettingsSchema = z.object({
  unitValue: z.number().positive().nullable(),
});
export type TelegramBancaSettings = z.infer<typeof TelegramBancaSettingsSchema>;

export const UpdateTelegramBancaSettingsInput = z.object({
  unitValue: z.number().positive().nullable(),
});
export type UpdateTelegramBancaSettingsInput = z.infer<typeof UpdateTelegramBancaSettingsInput>;

export const TelegramBookmakerBalanceSchema = z.object({
  bookmaker: z.string().min(1).max(80),
  balance: z.number(),
});
export type TelegramBookmakerBalance = z.infer<typeof TelegramBookmakerBalanceSchema>;

export const UpdateTelegramBookmakerBalancesInput = z.array(TelegramBookmakerBalanceSchema).max(50);
export type UpdateTelegramBookmakerBalancesInput = z.infer<typeof UpdateTelegramBookmakerBalancesInput>;
