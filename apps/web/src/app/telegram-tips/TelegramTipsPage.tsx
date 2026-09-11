import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  fetchTelegramTips,
  fetchTelegramGroups,
  fetchTelegramSettings,
  fetchBookmakerNames,
  fetchTelegramTodaySummary,
  patchTelegramTip,
  type TelegramTip,
  type TelegramGroup,
  type TelegramTodaySummary,
} from "../../lib/telegramTips";
import { Modal } from "../../components/Modal";
import { Dropdown } from "../../components/Dropdown";
import { bookmakerLabel } from "../../lib/bookmakers";
import { IconTelegram, IconExternalLink, IconCheck, IconX, IconSearch } from "../../components/Icon";
import { useAuth } from "../../stores/auth";

const RESULT_FILTERS = [
  { key: "pending", label: "Pendentes" },
  { key: "green", label: "Green" },
  { key: "red", label: "Red" },
  { key: "reembolso", label: "Reemb." },
  { key: "", label: "Todas" },
] as const;

const RESULT_BUTTONS = [
  { key: "pending", label: "Pendente", activeClassName: "bg-surface-alt text-text" },
  { key: "green", label: "Green", activeClassName: "bg-accent-soft text-accent" },
  { key: "red", label: "Red", activeClassName: "bg-live/10 text-live" },
  { key: "reembolso", label: "Reemb.", activeClassName: "bg-vip-soft text-vip" },
] as const;

function relativeTime(iso: string): string {
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (min < 1) return "agora";
  if (min < 60) return `há ${min}min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h}h`;
  return `há ${Math.round(h / 24)}d`;
}

function formatBRL(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatUnits(v: number, showSign = false): string {
  const rounded = Math.round(v * 100) / 100;
  return `${showSign && rounded > 0 ? "+" : ""}${rounded}u`;
}

function parseDraftNumber(raw: string): number | null {
  const trimmed = raw.trim().replace(",", ".");
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Unsaved per-tip edits made while a row sits in the expanded/"Peguei"
 * state — nothing here is PATCHed until the group's "Salvar" is clicked. */
type DraftEdit = {
  unit: number | null;
  odd: number | null;
  bookmaker: string | null;
  betUrl: string | null;
};

/** One Telegram message can carry several selections/legs — same
 * groupId+telegramMessageId — that should be reviewed as a unit. */
type MessageGroup = {
  key: string;
  groupId: string;
  groupName: string;
  receivedAt: string;
  match: string | null;
  photoUrl: string | null;
  tips: TelegramTip[];
};

function groupTipsByMessage(tips: TelegramTip[]): MessageGroup[] {
  const map = new Map<string, MessageGroup>();
  for (const tip of tips) {
    const key = `${tip.groupId}:${tip.telegramMessageId}`;
    let group = map.get(key);
    if (!group) {
      group = {
        key,
        groupId: tip.groupId,
        groupName: tip.groupName,
        receivedAt: tip.receivedAt,
        match: null,
        photoUrl: null,
        tips: [],
      };
      map.set(key, group);
    }
    group.tips.push(tip);
    if (!group.match && tip.match) group.match = tip.match;
    if (!group.photoUrl && tip.photoUrl) group.photoUrl = tip.photoUrl;
  }
  return [...map.values()];
}

function TipRow({
  tip,
  draft,
  unitValue,
  onUpdate,
  onStartDraft,
  onUpdateDraft,
  onUntakeServer,
}: {
  tip: TelegramTip;
  draft: DraftEdit | undefined;
  unitValue: number | null;
  onUpdate: (tip: TelegramTip) => void;
  onStartDraft: (tip: TelegramTip) => void;
  onUpdateDraft: (tip: TelegramTip, patch: Partial<DraftEdit>) => void;
  onUntakeServer: (tip: TelegramTip) => void;
}) {
  const { me } = useAuth();
  const isAdmin = me?.role === "admin";

  const isExpanded = tip.takenStatus === "taken" || draft !== undefined;
  const effUnit = draft?.unit ?? tip.unit;
  const effOdd = draft?.odd ?? tip.odd;
  const effBookmaker = draft?.bookmaker ?? tip.bookmaker;
  const effBetUrl = draft?.betUrl ?? tip.betUrl;
  const retorno = effUnit != null && effOdd != null && unitValue != null ? effUnit * unitValue * effOdd : null;
  const oddDrifted = tip.originalOdd !== null && tip.odd !== null && tip.originalOdd !== tip.odd;
  const betActive = tip.takenStatus === "taken" && !!effBetUrl;

  async function setResult(result: (typeof RESULT_BUTTONS)[number]["key"]) {
    onUpdate(await patchTelegramTip(tip.id, { result }));
  }

  if (!isExpanded) {
    return (
      <div className="flex items-center gap-2.5 border-t border-border-subtle py-2.5 first:border-t-0">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold">{tip.selection ?? "—"}</p>
          <p className="font-mono text-[11px] text-text-tertiary">
            {tip.odd != null ? tip.odd.toFixed(2) : "—"}
            {tip.unit != null && ` · ${tip.unit}u`}
          </p>
        </div>
        <button
          onClick={() => onStartDraft(tip)}
          className="flex-none rounded-lg border border-border-strong px-3.5 py-1.5 text-[12px] font-semibold text-text-secondary"
        >
          Pegar
        </button>
      </div>
    );
  }

  return (
    <div className="border-t border-border-subtle py-3 first:border-t-0">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <p className="min-w-0 flex-1 truncate text-[13px] font-semibold">{tip.selection ?? "—"}</p>
        <button
          onClick={() => onUntakeServer(tip)}
          className="flex flex-none items-center gap-1 rounded-lg bg-accent px-3.5 py-1.5 text-[12px] font-bold text-[#08090A]"
        >
          <IconCheck size={11} /> Peguei
        </button>
      </div>

      <div className="mb-2.5 grid grid-cols-2 gap-2 lg:grid-cols-4">
        <div className="flex flex-col gap-0.5 rounded-[10px] border border-accent-border bg-accent-soft p-2.5">
          <span className="text-[10px] text-text-secondary">Unidade</span>
          <input
            inputMode="decimal"
            value={effUnit ?? ""}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => onUpdateDraft(tip, { unit: parseDraftNumber(e.target.value) })}
            className="w-full rounded bg-transparent font-mono text-[14px] font-bold text-accent outline-none"
          />
          {effUnit != null && unitValue != null && (
            <span className="font-mono text-[10px] text-accent/80">{formatBRL(effUnit * unitValue)}</span>
          )}
        </div>
        <div className="flex flex-col gap-0.5 rounded-[10px] border border-border-subtle bg-surface-chip p-2.5">
          <span className="text-[10px] text-text-secondary">Minha odd</span>
          <input
            inputMode="decimal"
            value={effOdd ?? ""}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => onUpdateDraft(tip, { odd: parseDraftNumber(e.target.value) })}
            className="w-full rounded bg-transparent font-mono text-[14px] font-bold outline-none"
          />
          {oddDrifted && (
            <span className="text-[10px] leading-tight text-vip">
              Odd da mensagem era {tip.originalOdd!.toFixed(2)} e está {tip.odd!.toFixed(2)} agora.
            </span>
          )}
        </div>
        <div className="flex flex-col gap-0.5 rounded-[10px] border border-border-subtle bg-surface-chip p-2.5">
          <span className="text-[10px] text-text-secondary">Casa</span>
          {tip.bookmakerOptions && tip.bookmakerOptions.length > 1 ? (
            <Dropdown
              value={effBookmaker ?? ""}
              placeholder="Escolha a casa"
              options={tip.bookmakerOptions.map((o, i) => ({
                value: o.bookmaker ?? "",
                label: o.bookmaker ? bookmakerLabel(o.bookmaker) : `casa ${i + 1}`,
              }))}
              onChange={(bookmaker) => {
                const chosen = tip.bookmakerOptions!.find((o) => o.bookmaker === bookmaker);
                if (!chosen) return;
                onUpdateDraft(tip, { bookmaker: chosen.bookmaker, betUrl: chosen.betUrl });
              }}
              buttonClassName="rounded-md bg-transparent p-0 text-[13px] font-bold"
            />
          ) : (
            <span className="truncate text-[13px] font-bold">{bookmakerLabel(effBookmaker)}</span>
          )}
        </div>
        <div className="flex flex-col gap-0.5 rounded-[10px] border border-border-subtle bg-surface-chip p-2.5">
          <span className="text-[10px] text-text-secondary">Retorno</span>
          <span className="font-mono text-[14px] font-bold">{retorno != null ? formatBRL(retorno) : "—"}</span>
        </div>
      </div>

      <a
        href={betActive ? effBetUrl! : undefined}
        target={betActive ? "_blank" : undefined}
        rel="noreferrer"
        onClick={(e) => {
          if (!betActive) e.preventDefault();
        }}
        aria-disabled={!betActive}
        className={`mb-2.5 flex h-[38px] items-center justify-center gap-1.5 rounded-xl text-[13px] font-bold ${
          betActive ? "bg-accent text-[#08090A]" : "cursor-not-allowed bg-surface-chip text-text-tertiary"
        }`}
      >
        Abrir aposta{effBookmaker ? ` na ${bookmakerLabel(effBookmaker)}` : ""} <IconExternalLink size={12} />
      </a>

      {isAdmin ? (
        <div className="flex gap-1.5">
          {RESULT_BUTTONS.map((r) => (
            <button
              key={r.key}
              onClick={() => setResult(r.key)}
              className={`flex-1 rounded-lg py-1.5 text-[11px] font-semibold ${
                tip.result === r.key ? r.activeClassName : "bg-surface-chip text-text-tertiary"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      ) : (
        <div className="flex items-center justify-center rounded-lg bg-surface-chip py-1.5 text-[11px] font-semibold text-text-tertiary">
          {RESULT_BUTTONS.find((r) => r.key === tip.result)?.label ?? "Pendente"}
        </div>
      )}
    </div>
  );
}

function MessageGroupCard({
  group,
  drafts,
  unitValue,
  onUpdate,
  onOpenPhoto,
  onStartDraft,
  onUpdateDraft,
  onUntakeServer,
  onSaveGroup,
  onIgnoreGroup,
}: {
  group: MessageGroup;
  drafts: Record<string, DraftEdit>;
  unitValue: number | null;
  onUpdate: (tip: TelegramTip) => void;
  onOpenPhoto: (url: string) => void;
  onStartDraft: (tip: TelegramTip) => void;
  onUpdateDraft: (tip: TelegramTip, patch: Partial<DraftEdit>) => void;
  onUntakeServer: (tip: TelegramTip) => void;
  onSaveGroup: (group: MessageGroup) => Promise<void>;
  onIgnoreGroup: (group: MessageGroup) => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const [ignoring, setIgnoring] = useState(false);

  const fotoCount = group.tips.some((t) => t.photoUrl) ? 1 : 0;
  const tipsCount = group.tips.length;
  const pegasCount = group.tips.filter((t) => t.takenStatus === "taken").length;
  const draftCount = group.tips.filter((t) => t.id in drafts).length;
  const canIgnore = group.tips.some((t) => t.takenStatus === "pending" && !(t.id in drafts));

  return (
    <div className="rounded-[18px] border border-border bg-surface p-3.5 lg:p-4">
      <div className="mb-2 flex items-center gap-2">
        <IconTelegram size={13} className="flex-none text-accent" />
        <span className="truncate text-[12px] font-semibold text-accent">{group.groupName}</span>
        <span className="flex-none text-[11px] text-text-tertiary">{relativeTime(group.receivedAt)}</span>
        {group.match && (
          <>
            <span className="h-1 w-1 flex-none rounded-full bg-border-strong" />
            <span className="min-w-0 truncate text-[11px] text-text-secondary">{group.match}</span>
          </>
        )}
        <span className="ml-auto flex-none text-[11px] text-text-tertiary">
          {fotoCount} foto · {tipsCount} {tipsCount === 1 ? "tip" : "tips"} · {pegasCount} pegas
        </span>
      </div>

      {group.photoUrl && (
        <button
          onClick={() => onOpenPhoto(group.photoUrl!)}
          className="mb-2 text-[11px] font-semibold text-accent underline decoration-dotted underline-offset-2"
        >
          Ver imagem
        </button>
      )}

      <div className="flex flex-col">
        {group.tips.map((tip) => (
          <TipRow
            key={tip.id}
            tip={tip}
            draft={drafts[tip.id]}
            unitValue={unitValue}
            onUpdate={onUpdate}
            onStartDraft={onStartDraft}
            onUpdateDraft={onUpdateDraft}
            onUntakeServer={onUntakeServer}
          />
        ))}
      </div>

      <div className="mt-3 flex gap-2 border-t border-border-subtle pt-3">
        <button
          disabled={!canIgnore || ignoring}
          onClick={async () => {
            setIgnoring(true);
            try {
              await onIgnoreGroup(group);
            } finally {
              setIgnoring(false);
            }
          }}
          className="flex-1 rounded-lg border border-border-strong py-2 text-[12px] font-semibold text-text-secondary disabled:opacity-40"
        >
          Ignorar mensagem
        </button>
        <button
          disabled={draftCount === 0 || saving}
          onClick={async () => {
            setSaving(true);
            try {
              await onSaveGroup(group);
            } finally {
              setSaving(false);
            }
          }}
          className="flex-1 rounded-lg bg-accent py-2 text-[12px] font-bold text-[#08090A] disabled:bg-surface-chip disabled:font-semibold disabled:text-text-tertiary"
        >
          Salvar{draftCount > 0 ? ` ${draftCount}` : ""} tips
        </button>
      </div>
    </div>
  );
}

export function TelegramTipsPage() {
  const [tips, setTips] = useState<TelegramTip[] | null>(null);
  const [groups, setGroups] = useState<TelegramGroup[]>([]);
  const [groupId, setGroupId] = useState<string>("");
  const [result, setResultFilter] = useState<string>("pending");
  const [bookmaker, setBookmaker] = useState<string>("");
  const [bookmakers, setBookmakers] = useState<string[]>([]);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [photoModal, setPhotoModal] = useState<string | null>(null);
  const [unitValue, setUnitValue] = useState<number | null>(null);
  const [summary, setSummary] = useState<TelegramTodaySummary | null>(null);
  const [pendingTips, setPendingTips] = useState<TelegramTip[]>([]);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, DraftEdit>>({});
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [, forceTick] = useState(0);

  useEffect(() => {
    fetchTelegramGroups().then(setGroups).catch(() => {});
    fetchTelegramSettings().then((s) => setUnitValue(s.unitValue)).catch(() => {});
    fetchBookmakerNames().then(setBookmakers).catch(() => {});
    fetchTelegramTips({ limit: 1 })
      .then((res) => setLastSyncAt(res.data[0]?.receivedAt ?? null))
      .catch(() => {});
  }, []);

  // Keeps the "sincronizado há Nmin" line fresh without refetching.
  useEffect(() => {
    const id = setInterval(() => forceTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const id = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(id);
  }, [searchInput]);

  function refreshSummary() {
    fetchTelegramTodaySummary().then(setSummary).catch(() => {});
  }

  function refreshPendingCounts() {
    fetchTelegramTips({ takenStatus: "pending", limit: 200 })
      .then((res) => setPendingTips(res.data))
      .catch(() => {});
  }

  useEffect(() => {
    refreshSummary();
    refreshPendingCounts();
  }, []);

  useEffect(() => {
    fetchTelegramTips({
      groupId: groupId || undefined,
      result: result || undefined,
      bookmaker: bookmaker || undefined,
      search: search || undefined,
      limit: 60,
    })
      .then((res) => setTips(res.data))
      .catch(() => setTips([]));
  }, [groupId, result, bookmaker, search]);

  function updateTip(updated: TelegramTip) {
    setTips((prev) => prev?.map((t) => (t.id === updated.id ? updated : t)) ?? prev);
  }

  function startDraft(tip: TelegramTip) {
    setDrafts((prev) => ({
      ...prev,
      [tip.id]: { unit: tip.unit, odd: tip.odd, bookmaker: tip.bookmaker, betUrl: tip.betUrl },
    }));
  }

  function updateDraft(tip: TelegramTip, patch: Partial<DraftEdit>) {
    setDrafts((prev) => {
      const base = prev[tip.id] ?? { unit: tip.unit, odd: tip.odd, bookmaker: tip.bookmaker, betUrl: tip.betUrl };
      return { ...prev, [tip.id]: { ...base, ...patch } };
    });
  }

  function discardDraft(tipId: string) {
    setDrafts((prev) => {
      if (!(tipId in prev)) return prev;
      const next = { ...prev };
      delete next[tipId];
      return next;
    });
  }

  async function untakeServer(tip: TelegramTip) {
    if (tip.takenStatus === "taken") {
      const updated = await patchTelegramTip(tip.id, { takenStatus: "pending" });
      updateTip(updated);
      refreshSummary();
      refreshPendingCounts();
    }
    discardDraft(tip.id);
  }

  async function saveGroup(group: MessageGroup) {
    const toSave = group.tips.filter((t) => t.id in drafts);
    if (toSave.length === 0) return;
    const results = await Promise.all(
      toSave.map((tip) => {
        const d = drafts[tip.id]!;
        return patchTelegramTip(tip.id, {
          unit: d.unit,
          odd: d.odd,
          bookmaker: d.bookmaker,
          betUrl: d.betUrl,
          takenStatus: "taken",
        });
      }),
    );
    results.forEach(updateTip);
    setDrafts((prev) => {
      const next = { ...prev };
      for (const t of toSave) delete next[t.id];
      return next;
    });
    refreshSummary();
    refreshPendingCounts();
  }

  async function ignoreGroup(group: MessageGroup) {
    const toSkip = group.tips.filter((t) => t.takenStatus === "pending" && !(t.id in drafts));
    if (toSkip.length === 0) return;
    const results = await Promise.all(toSkip.map((tip) => patchTelegramTip(tip.id, { takenStatus: "skipped" })));
    results.forEach(updateTip);
    refreshSummary();
    refreshPendingCounts();
  }

  const groupedList = useMemo(() => groupTipsByMessage(tips ?? []), [tips]);

  const pendingCountsByGroup = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of pendingTips) map.set(t.groupId, (map.get(t.groupId) ?? 0) + 1);
    return map;
  }, [pendingTips]);

  return (
    <div className="pb-6 lg:mx-auto lg:max-w-[1100px] lg:px-0 lg:pt-6">
      {/* Header */}
      <div className="flex items-center gap-2.5 px-4 pb-3 pt-4 lg:px-0">
        <IconTelegram size={22} className="flex-none text-accent" />
        <div className="min-w-0 flex-1">
          <div className="text-[19px] font-bold tracking-[-0.02em] lg:text-[22px]">VIP Telegram</div>
          <p className="truncate text-[11px] text-text-tertiary">
            {lastSyncAt ? `sincronizado ${relativeTime(lastSyncAt)}` : "sincronizando…"} · {groups.length} grupos
          </p>
        </div>
        <div className="flex flex-none items-center gap-2">
          <Link
            to="/profile"
            className="hidden rounded-[11px] border border-border-strong px-3.5 py-2 text-[13px] font-semibold text-text-secondary lg:block"
          >
            Minha banca
          </Link>
          <Link
            to="/telegram-tips/relatorio"
            className="hidden rounded-[11px] bg-accent px-3.5 py-2 text-[13px] font-bold text-[#08090A] lg:block"
          >
            Relatório
          </Link>
          <Link
            to="/telegram-tips/relatorio"
            aria-label="Relatório"
            className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-accent text-[#08090A] lg:hidden"
          >
            <IconExternalLink size={15} />
          </Link>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2 px-4 pb-3 lg:flex lg:gap-6 lg:px-0 lg:pb-4">
        <div className="rounded-xl border border-border-subtle bg-surface-chip px-3 py-2 lg:rounded-none lg:border-0 lg:bg-transparent lg:p-0">
          <div className="text-[9px] font-semibold uppercase tracking-wide text-text-tertiary">Tips pendentes</div>
          <div className="font-mono text-[15px] font-bold">{summary?.pendingCount ?? "—"}</div>
        </div>
        <div className="rounded-xl border border-border-subtle bg-surface-chip px-3 py-2 lg:rounded-none lg:border-0 lg:bg-transparent lg:p-0">
          <div className="text-[9px] font-semibold uppercase tracking-wide text-text-tertiary">Peguei hoje</div>
          <div className="font-mono text-[15px] font-bold">
            {summary?.takenTodayCount ?? "—"}
            {summary && <span className="text-text-tertiary"> · {formatUnits(summary.takenTodayUnits)}</span>}
          </div>
        </div>
        <div className="rounded-xl border border-border-subtle bg-surface-chip px-3 py-2 lg:rounded-none lg:border-0 lg:bg-transparent lg:p-0">
          <div className="text-[9px] font-semibold uppercase tracking-wide text-text-tertiary">Resultado hoje</div>
          <div
            className={`font-mono text-[15px] font-bold ${
              summary && summary.resultTodayUnits < 0 ? "text-live" : "text-accent"
            }`}
          >
            {summary ? formatUnits(summary.resultTodayUnits, true) : "—"}
          </div>
        </div>
      </div>

      {/* Group filter chips + search + bookmaker */}
      <div className="flex flex-wrap items-center gap-2 px-4 pb-2 lg:px-0">
        <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto">
          <button
            onClick={() => setGroupId("")}
            className={`flex-none rounded-full px-3.5 py-1.5 text-[12px] ${
              groupId === "" ? "bg-accent font-semibold text-[#08090A]" : "bg-surface-alt text-text-secondary"
            }`}
          >
            Todos os grupos {summary?.pendingCount ?? pendingTips.length}
          </button>
          {groups.map((g) => (
            <button
              key={g.id}
              onClick={() => setGroupId(g.id)}
              className={`flex-none rounded-full px-3.5 py-1.5 text-[12px] ${
                groupId === g.id ? "bg-accent font-semibold text-[#08090A]" : "bg-surface-alt text-text-secondary"
              }`}
            >
              {g.name} {pendingCountsByGroup.get(g.id) ?? 0}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 px-4 pb-4 lg:px-0">
        <div className="flex min-w-[160px] flex-1 items-center gap-2 rounded-xl border border-border-subtle bg-surface-chip px-3 py-2 lg:max-w-[260px] lg:flex-none">
          <IconSearch size={14} className="flex-none text-text-tertiary" />
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Buscar tip"
            className="w-full min-w-0 bg-transparent text-[13px] text-text outline-none placeholder:text-text-tertiary"
          />
        </div>
        <Dropdown
          value={bookmaker}
          onChange={setBookmaker}
          placeholder="Todas as casas"
          options={bookmakers.map((b) => ({ value: b, label: bookmakerLabel(b) }))}
          className="w-auto flex-none"
        />
      </div>

      {/* Result pills */}
      <div className="flex gap-2 overflow-x-auto px-4 pb-4 lg:px-0">
        {RESULT_FILTERS.map((r) => (
          <button
            key={r.key}
            onClick={() => setResultFilter(r.key)}
            className={`flex-none rounded-full px-3.5 py-1.5 text-[12px] ${
              result === r.key ? "bg-accent-soft font-semibold text-accent" : "bg-surface-chip text-text-secondary"
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      {/* Tip list */}
      <div className="flex flex-col gap-3 px-4 lg:px-0">
        {tips === null && <p className="py-10 text-center text-sm text-text-tertiary">Carregando…</p>}
        {tips?.length === 0 && <p className="py-10 text-center text-sm text-text-tertiary">Nenhuma tip encontrada.</p>}

        {!bannerDismissed && groupedList.length > 0 && (
          <div className="flex items-center gap-2 rounded-xl border border-border-subtle bg-surface-chip px-3.5 py-2.5 text-[11px] text-text-tertiary">
            <span className="flex-1">Unidade, odd e a casa vêm da mensagem — a odd que você pegou é opcional.</span>
            <button onClick={() => setBannerDismissed(true)} aria-label="Dispensar" className="flex-none text-text-tertiary">
              <IconX size={12} />
            </button>
          </div>
        )}

        {groupedList.map((group) => (
          <MessageGroupCard
            key={group.key}
            group={group}
            drafts={drafts}
            unitValue={unitValue}
            onUpdate={updateTip}
            onOpenPhoto={setPhotoModal}
            onStartDraft={startDraft}
            onUpdateDraft={updateDraft}
            onUntakeServer={untakeServer}
            onSaveGroup={saveGroup}
            onIgnoreGroup={ignoreGroup}
          />
        ))}
      </div>

      <Modal open={photoModal !== null} onClose={() => setPhotoModal(null)} widthClassName="max-w-2xl">
        {photoModal && <img src={photoModal} alt="Bilhete" className="w-full rounded-2xl" />}
      </Modal>
    </div>
  );
}
