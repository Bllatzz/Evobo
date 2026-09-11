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
import {
  IconTelegram,
  IconExternalLink,
  IconCheck,
  IconX,
  IconSearch,
  IconChevronDown,
  IconEyeOff,
} from "../../components/Icon";
import { useAuth } from "../../stores/auth";

const RESULT_FILTERS = [
  { key: "pending", label: "Pendentes" },
  { key: "green", label: "Green" },
  { key: "red", label: "Red" },
  { key: "reembolso", label: "Reemb." },
] as const;

const TAKEN_FILTERS = [
  { key: "taken", label: "Peguei" },
  { key: "pending", label: "Não peguei" },
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
  onUpdateDraft,
  onUntake,
}: {
  tip: TelegramTip;
  draft: DraftEdit | undefined;
  unitValue: number | null;
  onUpdate: (tip: TelegramTip) => void;
  onUpdateDraft: (tip: TelegramTip, patch: Partial<DraftEdit>) => void;
  onUntake: (tip: TelegramTip) => void;
}) {
  const { me } = useAuth();
  const isAdmin = me?.role === "admin";
  // Rows are always shown expanded/editable by default — "collapsed" is a
  // purely visual, per-row toggle so a reviewed tip can be tucked away
  // without needing a separate "peguei"/take step to get there.
  const [collapsed, setCollapsed] = useState(false);

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

  if (collapsed) {
    return (
      <div className="flex items-center gap-2.5 border-t border-border-subtle py-2.5 first:border-t-0">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold">{tip.selection ?? "—"}</p>
          <p className="font-mono text-[11px] text-text-tertiary">
            {effOdd != null ? effOdd.toFixed(2) : "—"}
            {effUnit != null && ` · ${effUnit}u`}
            {tip.takenStatus === "taken" && " · peguei"}
          </p>
        </div>
        <button
          onClick={() => setCollapsed(false)}
          aria-label="Mostrar tip"
          className="flex-none rounded-lg border border-border-strong p-1.5 text-text-secondary"
        >
          <IconChevronDown size={14} />
        </button>
      </div>
    );
  }

  return (
    <div className="border-t border-border-subtle py-3 first:border-t-0">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <p className="min-w-0 flex-1 truncate text-[13px] font-semibold">{tip.selection ?? "—"}</p>
        {tip.takenStatus === "taken" && (
          <button
            onClick={() => onUntake(tip)}
            className="flex flex-none items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-[12px] font-bold text-[#08090A]"
          >
            <IconCheck size={11} /> Peguei
          </button>
        )}
        <button
          onClick={() => setCollapsed(true)}
          aria-label="Ocultar tip"
          className="flex-none rounded-lg border border-border-strong p-1.5 text-text-secondary"
        >
          <IconChevronDown size={14} className="rotate-180" />
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
  onUpdateDraft,
  onUntake,
  onSaveGroup,
}: {
  group: MessageGroup;
  drafts: Record<string, DraftEdit>;
  unitValue: number | null;
  onUpdate: (tip: TelegramTip) => void;
  onOpenPhoto: (url: string) => void;
  onUpdateDraft: (tip: TelegramTip, patch: Partial<DraftEdit>) => void;
  onUntake: (tip: TelegramTip) => void;
  onSaveGroup: (group: MessageGroup) => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  // The photo starts visible — no click needed to see the bilhete — with
  // just a close toggle to tuck it away if it's in the way.
  const [showPhoto, setShowPhoto] = useState(true);

  const fotoCount = group.tips.some((t) => t.photoUrl) ? 1 : 0;
  const tipsCount = group.tips.length;
  const pegasCount = group.tips.filter((t) => t.takenStatus === "taken").length;
  const pendingCount = tipsCount - pegasCount;

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
        <div className="mb-2.5">
          {showPhoto ? (
            <div className="relative">
              <img
                src={group.photoUrl}
                alt="Bilhete"
                onClick={() => onOpenPhoto(group.photoUrl!)}
                className="max-h-[360px] w-full cursor-zoom-in rounded-xl bg-surface-chip object-contain"
              />
              <button
                onClick={() => setShowPhoto(false)}
                aria-label="Fechar imagem"
                className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-[#08090A]/70 text-white"
              >
                <IconX size={13} />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowPhoto(true)}
              className="flex items-center gap-1.5 text-[11px] font-semibold text-accent"
            >
              <IconEyeOff size={13} /> Ver imagem
            </button>
          )}
        </div>
      )}

      <div className="flex flex-col">
        {group.tips.map((tip) => (
          <TipRow
            key={tip.id}
            tip={tip}
            draft={drafts[tip.id]}
            unitValue={unitValue}
            onUpdate={onUpdate}
            onUpdateDraft={onUpdateDraft}
            onUntake={onUntake}
          />
        ))}
      </div>

      <div className="mt-3 border-t border-border-subtle pt-3">
        <button
          disabled={pendingCount === 0 || saving}
          onClick={async () => {
            setSaving(true);
            try {
              await onSaveGroup(group);
            } finally {
              setSaving(false);
            }
          }}
          className="w-full rounded-lg bg-accent py-2 text-[12px] font-bold text-[#08090A] disabled:bg-surface-chip disabled:font-semibold disabled:text-text-tertiary"
        >
          Salvar{pendingCount > 0 ? ` ${pendingCount}` : ""} tips
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
  const [takenStatus, setTakenStatus] = useState<string>("");
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
      takenStatus: takenStatus || undefined,
      bookmaker: bookmaker || undefined,
      search: search || undefined,
      limit: 60,
    })
      .then((res) => setTips(res.data))
      .catch(() => setTips([]));
  }, [groupId, result, takenStatus, bookmaker, search]);

  function updateTip(updated: TelegramTip) {
    setTips((prev) => prev?.map((t) => (t.id === updated.id ? updated : t)) ?? prev);
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

  async function untake(tip: TelegramTip) {
    const updated = await patchTelegramTip(tip.id, { takenStatus: "pending" });
    updateTip(updated);
    discardDraft(tip.id);
    refreshSummary();
    refreshPendingCounts();
  }

  // Every tip in the group is always shown editable — Salvar commits
  // whichever ones aren't taken yet, using any local edits made to them
  // (falling back to the tip's own parsed values when untouched).
  async function saveGroup(group: MessageGroup) {
    const toSave = group.tips.filter((t) => t.takenStatus !== "taken");
    if (toSave.length === 0) return;
    const results = await Promise.all(
      toSave.map((tip) => {
        const d = drafts[tip.id] ?? { unit: tip.unit, odd: tip.odd, bookmaker: tip.bookmaker, betUrl: tip.betUrl };
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
      <div className="grid grid-cols-3 gap-2 px-4 pb-4 lg:gap-3 lg:px-0">
        <div className="rounded-2xl border border-border bg-surface p-3.5 lg:p-4.5">
          <div className="mb-1 font-mono text-[9px] tracking-[0.05em] text-text-tertiary lg:text-[10px]">
            TIPS PENDENTES
          </div>
          <div className="font-mono text-[18px] font-bold lg:text-[22px]">{summary?.pendingCount ?? "—"}</div>
        </div>
        <div className="rounded-2xl border border-border bg-surface p-3.5 lg:p-4.5">
          <div className="mb-1 font-mono text-[9px] tracking-[0.05em] text-text-tertiary lg:text-[10px]">
            PEGUEI HOJE
          </div>
          <div className="font-mono text-[18px] font-bold lg:text-[22px]">
            {summary?.takenTodayCount ?? "—"}
            {summary && <span className="text-[12px] text-text-tertiary lg:text-[14px]"> · {formatUnits(summary.takenTodayUnits)}</span>}
          </div>
        </div>
        <div className="rounded-2xl border border-border bg-surface p-3.5 lg:p-4.5">
          <div className="mb-1 font-mono text-[9px] tracking-[0.05em] text-text-tertiary lg:text-[10px]">
            RESULTADO HOJE
          </div>
          <div
            className={`font-mono text-[18px] font-bold lg:text-[22px] ${
              summary && summary.resultTodayUnits < 0 ? "text-live" : "text-accent"
            }`}
          >
            {summary ? formatUnits(summary.resultTodayUnits, true) : "—"}
          </div>
        </div>
      </div>

      {/* Filters: grupo, peguei/não peguei, resultado, casa — all selects — plus search */}
      <div className="flex flex-wrap items-center gap-2 px-4 pb-4 lg:px-0">
        <div className="flex min-w-[160px] flex-1 items-center gap-2 rounded-xl border border-border-subtle bg-surface-chip px-3 py-2 lg:max-w-[240px] lg:flex-none">
          <IconSearch size={14} className="flex-none text-text-tertiary" />
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Buscar tip"
            className="w-full min-w-0 bg-transparent text-[13px] text-text outline-none placeholder:text-text-tertiary"
          />
        </div>
        <Dropdown
          value={groupId}
          onChange={setGroupId}
          placeholder={`Todos os grupos (${summary?.pendingCount ?? pendingTips.length})`}
          options={groups.map((g) => ({ value: g.id, label: `${g.name} (${pendingCountsByGroup.get(g.id) ?? 0})` }))}
          className="w-auto flex-none"
        />
        <Dropdown
          value={takenStatus}
          onChange={setTakenStatus}
          placeholder="Peguei ou não"
          options={TAKEN_FILTERS.map((f) => ({ value: f.key, label: f.label }))}
          className="w-auto flex-none"
        />
        <Dropdown
          value={result}
          onChange={setResultFilter}
          placeholder="Todos os resultados"
          options={RESULT_FILTERS.map((f) => ({ value: f.key, label: f.label }))}
          className="w-auto flex-none"
        />
        <Dropdown
          value={bookmaker}
          onChange={setBookmaker}
          placeholder="Todas as casas"
          options={bookmakers.map((b) => ({ value: b, label: bookmakerLabel(b) }))}
          className="w-auto flex-none"
        />
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
            onUpdateDraft={updateDraft}
            onUntake={untake}
            onSaveGroup={saveGroup}
          />
        ))}
      </div>

      <Modal open={photoModal !== null} onClose={() => setPhotoModal(null)} widthClassName="max-w-2xl">
        {photoModal && <img src={photoModal} alt="Bilhete" className="w-full rounded-2xl" />}
      </Modal>
    </div>
  );
}
