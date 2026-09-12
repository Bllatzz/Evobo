import { useEffect, useMemo, useRef, useState } from "react";
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
  { key: "pending", label: "Pendentes", activeClassName: "bg-vip-soft text-vip" },
  { key: "green", label: "Green", activeClassName: "bg-accent-soft text-accent" },
  { key: "red", label: "Red", activeClassName: "bg-live/10 text-live" },
  { key: "reembolso", label: "Reemb.", activeClassName: "bg-vip-soft text-vip" },
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

/** Compact status chip on each row: "NÃO PEGA" while untaken (result is
 * irrelevant until you've taken it), otherwise the tip's own result. */
const STATUS_CHIPS: Record<string, { text: string; className: string }> = {
  pending: { text: "PENDENTE", className: "bg-vip-soft text-vip" },
  green: { text: "GREEN", className: "bg-accent-soft text-accent" },
  red: { text: "RED", className: "bg-live/10 text-live" },
  reembolso: { text: "REEMB.", className: "bg-surface-alt text-text-secondary" },
};
const NAO_PEGA_CHIP = { text: "NÃO PEGA", className: "bg-surface-alt text-text-tertiary" };

// Small fixed rotation over Evobo's own brand hues (never an invented color)
// so each Telegram group keeps a stable dot across renders.
const GROUP_DOT_COLORS = ["bg-accent", "bg-live", "bg-vip", "bg-verified", "bg-orange"];
function groupColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return GROUP_DOT_COLORS[hash % GROUP_DOT_COLORS.length]!;
}

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
  index,
  draft,
  unitValue,
  onUpdate,
  onUpdateDraft,
  onTake,
  onUntake,
  onHideAll,
}: {
  tip: TelegramTip;
  index: number;
  draft: DraftEdit | undefined;
  unitValue: number | null;
  onUpdate: (tip: TelegramTip) => void;
  onUpdateDraft: (tip: TelegramTip, patch: Partial<DraftEdit>) => void;
  onTake: (tip: TelegramTip) => void;
  onUntake: (tip: TelegramTip) => void;
  /** Collapsing a tip also tucks away the shared bilhete photo — there's
   * nothing left to reference it against once the tip itself is hidden. */
  onHideAll: () => void;
}) {
  const { me } = useAuth();
  const isAdmin = me?.role === "admin";
  // Rows are always shown expanded/editable by default — "collapsed" is a
  // purely visual, per-row toggle so a reviewed tip can be tucked away
  // without needing a separate "peguei"/take step to get there.
  const [collapsed, setCollapsed] = useState(false);

  const effUnit = draft?.unit ?? tip.unit;
  const effOdd = draft?.odd ?? tip.odd;
  // Falls back to the first parsed option so "Abrir aposta" already has
  // somewhere to go before the user explicitly picks a casa — otherwise
  // every multi-bookmaker tip started with the link dead until that pick.
  const firstOption = tip.bookmakerOptions?.[0];
  const effBookmaker = draft?.bookmaker ?? tip.bookmaker ?? firstOption?.bookmaker ?? null;
  const effBetUrl = draft?.betUrl ?? tip.betUrl ?? firstOption?.betUrl ?? null;
  const oddDrifted = tip.originalOdd !== null && tip.odd !== null && tip.originalOdd !== tip.odd;
  const betActive = !!effBetUrl;
  const chip = tip.takenStatus === "taken" ? (STATUS_CHIPS[tip.result] ?? STATUS_CHIPS.pending!) : NAO_PEGA_CHIP;

  async function setResult(result: (typeof RESULT_BUTTONS)[number]["key"]) {
    onUpdate(await patchTelegramTip(tip.id, { result }));
  }

  // Untaken: a ghost "Pegar" button anyone can act on immediately, in both
  // the collapsed and expanded row. Taken: a filled "✓ Peguei" undo button
  // while expanded — but once collapsed (reviewed/done), the status chip
  // alone is enough, so the button drops to reduce noise on settled rows.
  const takenPill =
    tip.takenStatus === "taken" ? (
      collapsed ? null : (
        <button
          onClick={() => onUntake(tip)}
          className="flex flex-none items-center gap-1 rounded-lg bg-accent px-2.5 py-1 text-[11px] font-bold text-[#08090A]"
        >
          <IconCheck size={10} /> Peguei
        </button>
      )
    ) : (
      <button
        onClick={() => onTake(tip)}
        className="flex flex-none items-center gap-1 rounded-lg border border-border-strong bg-surface-chip px-2.5 py-1 text-[11px] font-bold text-text-secondary"
      >
        Pegar
      </button>
    );

  if (collapsed) {
    return (
      <div className="flex items-center gap-2.5 border-t border-border-subtle py-2.5 first:border-t-0">
        <span className="w-3.5 flex-none text-center font-mono text-[11px] text-text-tertiary">{index}</span>
        {takenPill}
        <p className="min-w-0 flex-1 truncate text-[13px] font-semibold">{tip.selection ?? "—"}</p>
        <span className="flex-none font-mono text-[12px] font-bold">{effOdd != null ? effOdd.toFixed(2) : "—"}</span>
        <span className="flex-none font-mono text-[12px] text-text-tertiary">{effUnit != null ? `${effUnit}u` : "—"}</span>
        <span className={`flex-none rounded-md px-2 py-1 font-mono text-[9px] font-bold tracking-[0.03em] ${chip.className}`}>
          {chip.text}
        </span>
        <button
          onClick={() => setCollapsed(false)}
          aria-label="Mostrar tip"
          className="flex-none rounded-lg border border-border-strong bg-surface-chip p-1.5 text-text-secondary"
        >
          <IconChevronDown size={14} />
        </button>
      </div>
    );
  }

  return (
    <div className="border-t border-border-subtle py-3 first:border-t-0">
      <div className="mb-2.5 flex items-center gap-2.5">
        <span className="w-3.5 flex-none text-center font-mono text-[11px] text-text-tertiary">{index}</span>
        <p className="min-w-0 flex-1 truncate text-[13px] font-semibold">{tip.selection ?? "—"}</p>
        <span className="flex-none font-mono text-[12px] font-bold">{effOdd != null ? effOdd.toFixed(2) : "—"}</span>
        <span className="flex-none font-mono text-[12px] text-text-tertiary">{effUnit != null ? `${effUnit}u` : "—"}</span>
        <span className={`flex-none rounded-md px-2 py-1 font-mono text-[9px] font-bold tracking-[0.03em] ${chip.className}`}>
          {chip.text}
        </span>
        <button
          onClick={() => {
            setCollapsed(true);
            onHideAll();
          }}
          aria-label="Ocultar tip"
          className="flex-none self-start rounded-lg border border-border-strong bg-surface-chip p-1.5 text-text-secondary"
        >
          <IconChevronDown size={14} className="rotate-180" />
        </button>
      </div>

      <div className="mb-2.5 grid grid-cols-3 gap-2">
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
      </div>

      {isAdmin && (
        <>
          <span className="mb-1 block text-[10px] text-text-secondary">Resultado</span>
          <div className="mb-3 flex gap-1.5">
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
        </>
      )}

      <a
        href={betActive ? effBetUrl! : undefined}
        target={betActive ? "_blank" : undefined}
        rel="noreferrer"
        onClick={(e) => {
          if (!betActive) e.preventDefault();
        }}
        aria-disabled={!betActive}
        className={`mb-2 flex h-10 items-center justify-center gap-1.5 rounded-lg text-[12px] font-bold ${
          betActive ? "bg-accent text-[#08090A]" : "cursor-not-allowed bg-surface-alt text-text-tertiary"
        }`}
      >
        {betActive ? `Abrir na ${bookmakerLabel(effBookmaker)}` : "Sem link"} <IconExternalLink size={11} />
      </a>

      <div className="flex gap-2">
        <button
          onClick={() => onTake(tip)}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2.5 text-[12px] font-bold ${
            tip.takenStatus === "taken" ? "bg-accent text-[#08090A]" : "bg-surface-chip text-text-tertiary"
          }`}
        >
          {tip.takenStatus === "taken" && <IconCheck size={11} />} Peguei
        </button>
        <button
          onClick={() => onUntake(tip)}
          className={`flex-1 rounded-lg py-2.5 text-[12px] font-bold ${
            tip.takenStatus !== "taken" ? "bg-live text-[#08090A]" : "bg-surface-chip text-text-tertiary"
          }`}
        >
          Não peguei
        </button>
      </div>
    </div>
  );
}

function MessageGroupCard({
  group,
  drafts,
  unitValue,
  photoVisible,
  onTogglePhoto,
  onUpdate,
  onOpenPhoto,
  onUpdateDraft,
  onTake,
  onUntake,
  onSaveDrafts,
}: {
  group: MessageGroup;
  drafts: Record<string, DraftEdit>;
  unitValue: number | null;
  photoVisible: boolean;
  onTogglePhoto: (key: string, visible: boolean) => void;
  onUpdate: (tip: TelegramTip) => void;
  onOpenPhoto: (url: string) => void;
  onUpdateDraft: (tip: TelegramTip, patch: Partial<DraftEdit>) => void;
  onTake: (tip: TelegramTip) => void;
  onUntake: (tip: TelegramTip) => void;
  onSaveDrafts: (group: MessageGroup) => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);

  const tipsCount = group.tips.length;
  const pegasCount = group.tips.filter((t) => t.takenStatus === "taken").length;
  const draftCount = group.tips.filter((t) => drafts[t.id]).length;

  return (
    <div className="rounded-[18px] border border-border bg-surface p-3.5 lg:p-4">
      <div className="mb-2 flex items-center gap-2">
        <IconTelegram size={13} className="flex-none text-accent" />
        <span className="truncate text-[12px] font-semibold text-accent">{group.groupName}</span>
        <span className="flex-none text-[11px] text-text-tertiary">{relativeTime(group.receivedAt)}</span>
        {group.match && (
          <>
            <span className={`h-2 w-2 flex-none rounded-[3px] ${groupColor(group.groupName)}`} />
            <span className="min-w-0 truncate text-[13px] font-semibold">{group.match}</span>
          </>
        )}
        <span className="ml-auto flex-none text-[11px] text-text-tertiary">
          {group.photoUrl ? "1 foto · " : ""}
          {tipsCount} {tipsCount === 1 ? "tip" : "tips"} · {pegasCount} {pegasCount === 1 ? "pega" : "pegas"}
        </span>
      </div>

      <div className="flex gap-3">
        {group.photoUrl && photoVisible && (
          <div className="w-[300px] flex-none">
            <div className="relative">
              <img
                src={group.photoUrl}
                alt="Bilhete"
                onClick={() => onOpenPhoto(group.photoUrl!)}
                className="h-[320px] w-full cursor-zoom-in rounded-xl bg-surface-chip object-contain"
              />
              <button
                onClick={() => onTogglePhoto(group.key, false)}
                aria-label="Ocultar imagem"
                className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-[#08090A]/70 text-white"
              >
                <IconX size={12} />
              </button>
            </div>
            <div className="mt-1.5 flex gap-1.5">
              <button
                onClick={() => onOpenPhoto(group.photoUrl!)}
                className="flex-1 rounded-lg border border-border-strong py-1.5 text-[11px] font-semibold text-text-secondary"
              >
                Ampliar
              </button>
              <button
                onClick={() => onTogglePhoto(group.key, false)}
                className="flex-1 rounded-lg border border-border-strong py-1.5 text-[11px] font-semibold text-text-secondary"
              >
                Ocultar
              </button>
            </div>
          </div>
        )}
        {group.photoUrl && !photoVisible && (
          <button
            onClick={() => onTogglePhoto(group.key, true)}
            className="flex w-[64px] flex-none flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-border-strong py-4 text-[11px] font-semibold text-accent"
          >
            <IconEyeOff size={14} />
            Ver
          </button>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex flex-col">
            {group.tips.map((tip, i) => (
              <TipRow
                key={tip.id}
                tip={tip}
                index={i + 1}
                draft={drafts[tip.id]}
                unitValue={unitValue}
                onUpdate={onUpdate}
                onUpdateDraft={onUpdateDraft}
                onTake={onTake}
                onUntake={onUntake}
                onHideAll={() => onTogglePhoto(group.key, false)}
              />
            ))}
          </div>

          {draftCount > 0 && (
            <div className="mt-3 flex justify-end border-t border-border-subtle pt-3">
              <button
                disabled={saving}
                onClick={async () => {
                  setSaving(true);
                  try {
                    await onSaveDrafts(group);
                  } finally {
                    setSaving(false);
                  }
                }}
                className="rounded-lg bg-accent px-4 py-2 text-[12px] font-bold text-[#08090A] disabled:bg-surface-chip disabled:font-semibold disabled:text-text-tertiary"
              >
                {draftCount === 1 ? "Salvar tip" : `Salvar ${draftCount} tips`}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** "N grupos selecionados" trigger opens a staged checklist (nothing
 * applies until "Aplicar") — selections themselves render as removable
 * chips next to the trigger, not as a permanent row of every group. */
function GroupMultiSelect({
  groups,
  selected,
  onApply,
  countByGroup,
  totalCount,
}: {
  groups: TelegramGroup[];
  selected: string[];
  onApply: (ids: string[]) => void;
  countByGroup: (id: string) => number;
  totalCount: number;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<string[]>(selected);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  function openPanel() {
    setPending(selected);
    setOpen(true);
  }

  function toggle(id: string) {
    setPending((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  const selectedCount = selected.reduce((sum, id) => sum + countByGroup(id), 0);
  const label =
    selected.length === 0
      ? `Todos os grupos ${totalCount}`
      : `${selected.length} grupos selecionados ${selectedCount}`;

  return (
    <div ref={ref} className="relative flex-none">
      <button
        type="button"
        onClick={() => (open ? setOpen(false) : openPanel())}
        className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] ${
          selected.length === 0 ? "bg-accent font-semibold text-[#08090A]" : "bg-surface-alt text-text-secondary"
        }`}
      >
        {label}
        <IconChevronDown size={13} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute left-0 z-20 mt-1.5 w-max min-w-[240px] rounded-xl border border-border bg-surface p-1 shadow-lg">
          <div className="flex items-center justify-between px-3 py-1.5">
            <span className="font-mono text-[10px] tracking-[0.05em] text-text-tertiary">FILTRAR POR GRUPO</span>
            <button type="button" onClick={() => setPending([])} className="text-[11px] font-semibold text-accent">
              limpar
            </button>
          </div>
          <div className="max-h-56 overflow-y-auto [scrollbar-width:thin] [scrollbar-color:var(--color-border-strong)_transparent] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border-strong [&::-webkit-scrollbar-track]:bg-transparent">
            <label className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-[13px] text-text-secondary hover:bg-surface-alt">
              <input
                type="checkbox"
                checked={pending.length === 0}
                onChange={() => setPending([])}
                className="h-3.5 w-3.5 flex-none accent-accent"
              />
              <span className="min-w-0 flex-1 truncate">Todos os grupos</span>
              <span className="flex-none font-mono text-[11px] text-text-tertiary">{totalCount}</span>
            </label>
            {groups.map((g) => (
              <label
                key={g.id}
                className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-[13px] text-text-secondary hover:bg-surface-alt"
              >
                <input
                  type="checkbox"
                  checked={pending.includes(g.id)}
                  onChange={() => toggle(g.id)}
                  className="h-3.5 w-3.5 flex-none accent-accent"
                />
                <span className="min-w-0 flex-1 truncate">{g.name}</span>
                <span className="flex-none font-mono text-[11px] text-text-tertiary">{countByGroup(g.id)}</span>
              </label>
            ))}
          </div>
          <div className="p-1 pt-1.5">
            <button
              type="button"
              onClick={() => {
                onApply(pending);
                setOpen(false);
              }}
              className="w-full rounded-lg bg-accent py-2 text-[12px] font-bold text-[#08090A]"
            >
              Aplicar{pending.length > 0 ? ` (${pending.length})` : ""}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function TelegramTipsPage() {
  const [tips, setTips] = useState<TelegramTip[] | null>(null);
  const [groups, setGroups] = useState<TelegramGroup[]>([]);
  const [groupIds, setGroupIds] = useState<string[]>([]);
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
  const [drafts, setDrafts] = useState<Record<string, DraftEdit>>({});
  const [, forceTick] = useState(0);
  // Global photo visibility default, plus per-card overrides so one bilhete
  // can be peeked at (or tucked away) without flipping every other card.
  const [showPhotosGlobal, setShowPhotosGlobal] = useState(true);
  const [photoOverrides, setPhotoOverrides] = useState<Record<string, boolean>>({});

  useEffect(() => {
    fetchTelegramGroups().then(setGroups).catch(() => {});
    fetchTelegramSettings().then((s) => setUnitValue(s.unitValue)).catch(() => {});
    fetchBookmakerNames().then(setBookmakers).catch(() => {});
  }, []);

  // Keeps each card's "há Nmin" freshness label current without refetching.
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
      groupId: groupIds.length > 0 ? groupIds.join(",") : undefined,
      result: result || undefined,
      takenStatus: takenStatus || undefined,
      bookmaker: bookmaker || undefined,
      search: search || undefined,
      limit: 60,
    })
      .then((res) => setTips(res.data))
      .catch(() => setTips([]));
  }, [groupIds, result, takenStatus, bookmaker, search]);

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

  function isPhotoVisible(key: string): boolean {
    return photoOverrides[key] ?? showPhotosGlobal;
  }

  function togglePhoto(key: string, visible: boolean) {
    setPhotoOverrides((prev) => ({ ...prev, [key]: visible }));
  }

  function toggleGlobalPhotos() {
    setShowPhotosGlobal((v) => !v);
    setPhotoOverrides({});
  }

  // Per-row instant take: marks this one tip taken, folding in whatever
  // local unit/odd/casa edits are sitting in its draft (if any).
  async function takeTip(tip: TelegramTip) {
    const d = drafts[tip.id] ?? { unit: tip.unit, odd: tip.odd, bookmaker: tip.bookmaker, betUrl: tip.betUrl };
    const updated = await patchTelegramTip(tip.id, {
      unit: d.unit,
      odd: d.odd,
      bookmaker: d.bookmaker,
      betUrl: d.betUrl,
      takenStatus: "taken",
    });
    updateTip(updated);
    discardDraft(tip.id);
    refreshSummary();
    refreshPendingCounts();
  }

  // Bulk "Salvar N tips" only ever persists unsaved unit/odd/casa edits —
  // taking a tip is its own immediate action (takeTip) now, so this never
  // touches takenStatus.
  async function saveDrafts(group: MessageGroup) {
    const toSave = group.tips.filter((t) => drafts[t.id]);
    if (toSave.length === 0) return;
    const results = await Promise.all(
      toSave.map((tip) => {
        const d = drafts[tip.id]!;
        return patchTelegramTip(tip.id, { unit: d.unit, odd: d.odd, bookmaker: d.bookmaker, betUrl: d.betUrl });
      }),
    );
    results.forEach(updateTip);
    setDrafts((prev) => {
      const next = { ...prev };
      for (const t of toSave) delete next[t.id];
      return next;
    });
  }

  const groupedList = useMemo(() => groupTipsByMessage(tips ?? []), [tips]);

  const pendingCountsByGroup = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of pendingTips) map.set(t.groupId, (map.get(t.groupId) ?? 0) + 1);
    return map;
  }, [pendingTips]);

  return (
    <div className="pb-6 lg:pl-6 lg:pr-6 lg:pt-6">
      {/* Header */}
      <div className="flex items-center gap-2.5 px-4 pb-3 pt-4 lg:px-0">
        <IconTelegram size={22} className="flex-none text-accent" />
        <div className="min-w-0 flex-1 text-[19px] font-bold tracking-[-0.02em] lg:text-[22px]">VIP Telegram</div>
        <div className="hidden items-center gap-2 rounded-full border border-border-strong bg-surface-chip px-3 py-1.5 lg:flex">
          <button
            onClick={toggleGlobalPhotos}
            role="switch"
            aria-checked={showPhotosGlobal}
            className={`relative h-5 w-9 flex-none rounded-full border-0 p-0 transition-colors ${
              showPhotosGlobal ? "bg-accent" : "bg-surface-alt"
            }`}
          >
            <span
              className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
                showPhotosGlobal ? "translate-x-4" : "translate-x-0"
              }`}
            />
          </button>
          <span className="text-[13px] font-semibold text-text-secondary">Mostrar fotos</span>
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

      {/* Stats (standard site card chrome) + search/peguei/casa on the same row at desktop */}
      <div className="flex flex-col gap-3 px-4 pb-3 lg:flex-row lg:items-center lg:justify-between lg:px-0">
        <div className="flex items-center gap-2">
          <div className="flex flex-col gap-0.5 rounded-[10px] border border-border-subtle bg-surface-chip px-3.5 py-2.5">
            <span className="font-mono text-[9px] tracking-[0.05em] text-text-tertiary lg:text-[10px]">
              TIPS PENDENTES
            </span>
            <span className="font-mono text-[18px] font-bold text-vip lg:text-[20px]">
              {summary?.pendingCount ?? "—"}
            </span>
          </div>
          <div className="flex flex-col gap-0.5 rounded-[10px] border border-border-subtle bg-surface-chip px-3.5 py-2.5">
            <span className="font-mono text-[9px] tracking-[0.05em] text-text-tertiary lg:text-[10px]">
              PEGUEI HOJE
            </span>
            <span className="font-mono text-[18px] font-bold lg:text-[20px]">
              {summary?.takenTodayCount ?? "—"}
              {summary && <span className="text-[12px] text-text-tertiary lg:text-[13px]"> · {formatUnits(summary.takenTodayUnits)}</span>}
            </span>
          </div>
          <div className="flex flex-col gap-0.5 rounded-[10px] border border-border-subtle bg-surface-chip px-3.5 py-2.5">
            <span className="font-mono text-[9px] tracking-[0.05em] text-text-tertiary lg:text-[10px]">
              RESULTADO HOJE
            </span>
            <span
              className={`font-mono text-[18px] font-bold lg:text-[20px] ${
                summary && summary.resultTodayUnits < 0 ? "text-live" : "text-accent"
              }`}
            >
              {summary ? formatUnits(summary.resultTodayUnits, true) : "—"}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex min-w-[160px] flex-1 items-center gap-2 rounded-xl border border-border-subtle bg-surface-chip px-3 py-2 lg:max-w-[200px] lg:flex-none">
            <IconSearch size={14} className="flex-none text-text-tertiary" />
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Buscar tip"
              className="w-full min-w-0 bg-transparent text-[13px] text-text outline-none placeholder:text-text-tertiary"
            />
          </div>
          <Dropdown
            value={takenStatus}
            onChange={setTakenStatus}
            placeholder="Peguei ou não"
            options={TAKEN_FILTERS.map((f) => ({ value: f.key, label: f.label }))}
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
      </div>

      {/* Group filter (left) + result pills (right) on the same row at desktop */}
      <div className="flex flex-col gap-2 px-4 pb-4 lg:flex-row lg:items-center lg:justify-between lg:px-0">
        <div className="flex flex-wrap items-center gap-2">
          <GroupMultiSelect
            groups={groups}
            selected={groupIds}
            onApply={setGroupIds}
            countByGroup={(id) => pendingCountsByGroup.get(id) ?? 0}
            totalCount={summary?.pendingCount ?? pendingTips.length}
          />
          {groupIds.map((id) => {
            const g = groups.find((x) => x.id === id);
            if (!g) return null;
            return (
              <button
                key={id}
                onClick={() => setGroupIds(groupIds.filter((x) => x !== id))}
                className="flex flex-none items-center gap-1.5 rounded-full bg-accent-soft px-3.5 py-1.5 text-[12px] font-semibold text-accent"
              >
                {g.name}
                <IconX size={11} />
              </button>
            );
          })}
        </div>

        <div className="flex gap-2 overflow-x-auto">
          {RESULT_FILTERS.map((r) => (
            <button
              key={r.key}
              onClick={() => setResultFilter(r.key)}
              className={`flex-none rounded-full px-3.5 py-1.5 font-mono text-[11px] uppercase tracking-[0.02em] ${
                result === r.key ? `font-bold ${r.activeClassName}` : "text-text-secondary"
              }`}
            >
              {r.label}
            </button>
          ))}
          <button
            onClick={() => setResultFilter("")}
            className={`flex-none rounded-full px-3.5 py-1.5 font-mono text-[11px] uppercase tracking-[0.02em] ${
              result === "" ? "bg-accent-soft font-bold text-accent" : "text-text-secondary"
            }`}
          >
            Todas
          </button>
        </div>
      </div>

      {/* Tip list */}
      <div className="flex flex-col gap-3 px-4 lg:px-0">
        {tips === null && <p className="py-10 text-center text-sm text-text-tertiary">Carregando…</p>}
        {tips?.length === 0 && <p className="py-10 text-center text-sm text-text-tertiary">Nenhuma tip encontrada.</p>}

        {groupedList.map((group) => (
          <MessageGroupCard
            key={group.key}
            group={group}
            drafts={drafts}
            unitValue={unitValue}
            photoVisible={isPhotoVisible(group.key)}
            onTogglePhoto={togglePhoto}
            onUpdate={updateTip}
            onOpenPhoto={setPhotoModal}
            onUpdateDraft={updateDraft}
            onTake={takeTip}
            onUntake={untake}
            onSaveDrafts={saveDrafts}
          />
        ))}
      </div>

      <Modal open={photoModal !== null} onClose={() => setPhotoModal(null)} widthClassName="max-w-2xl">
        {photoModal && <img src={photoModal} alt="Bilhete" className="w-full rounded-2xl" />}
      </Modal>
    </div>
  );
}
