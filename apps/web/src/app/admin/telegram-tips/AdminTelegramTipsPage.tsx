import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  fetchTelegramTips,
  fetchTelegramGroups,
  fetchBookmakerNames,
  patchTelegramTip,
  retryMissingOcr,
  type TelegramTip,
  type TelegramGroup,
} from "../../../lib/telegramTips";
import { groupTipsByMessage, groupColor, relativeTime, type MessageGroup } from "../../telegram-tips/TelegramTipsPage";
import { Dropdown } from "../../../components/Dropdown";
import { BookmakerCombobox } from "../../../components/BookmakerCombobox";
import { Modal } from "../../../components/Modal";
import { bookmakerLabel } from "../../../lib/bookmakers";
import {
  IconChevronLeft,
  IconChevronDown,
  IconTelegram,
  IconExternalLink,
  IconEyeOff,
  IconX,
} from "../../../components/Icon";

const PAGE_SIZE = 30;

const RESULT_BUTTONS = [
  { key: "pending", label: "Pendente", activeClassName: "bg-surface-alt text-text" },
  { key: "green", label: "Green", activeClassName: "bg-accent-soft text-accent" },
  { key: "red", label: "Red", activeClassName: "bg-live/10 text-live" },
  { key: "reembolso", label: "Reemb.", activeClassName: "bg-vip-soft text-vip" },
] as const;

const STATUS_CHIPS: Record<string, { text: string; className: string }> = {
  pending: { text: "PENDENTE", className: "bg-vip-soft text-vip" },
  green: { text: "GREEN", className: "bg-accent-soft text-accent" },
  red: { text: "RED", className: "bg-live/10 text-live" },
  reembolso: { text: "REEMB.", className: "bg-surface-alt text-text-secondary" },
};

const MISSING_FILTERS = [
  { key: "odd", label: "Odd faltando" },
  { key: "unit", label: "Unidade faltando" },
  { key: "match", label: "Jogo faltando" },
  { key: "bookmaker", label: "Casa faltando" },
] as const;

function parseNumber(raw: string): number | null {
  const trimmed = raw.trim().replace(",", ".");
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Uma tip no registro OFICIAL — cada campo comita direto (blur/seleção),
 * sem rascunho: é correção pontual, não um fluxo de revisão em lote. Mesmo
 * visual da tela pessoal (VIP Telegram), só sem peguei/não peguei. */
function AdminTipRow({ tip, index, bookmakers, onUpdate }: { tip: TelegramTip; index: number; bookmakers: string[]; onUpdate: (tip: TelegramTip) => void }) {
  const [collapsed, setCollapsed] = useState(false);
  const [match, setMatch] = useState(tip.match ?? "");
  const [selection, setSelection] = useState(tip.selection ?? "");
  const [unitText, setUnitText] = useState(tip.unit != null ? String(tip.unit) : "");
  const [oddText, setOddText] = useState(tip.odd != null ? String(tip.odd) : "");
  const [betUrl, setBetUrl] = useState(tip.betUrl ?? "");
  const [saving, setSaving] = useState(false);

  const chip = STATUS_CHIPS[tip.result] ?? STATUS_CHIPS.pending!;
  const betActive = !!tip.betUrl;

  async function commit(patch: Parameters<typeof patchTelegramTip>[1]) {
    setSaving(true);
    try {
      onUpdate(await patchTelegramTip(tip.id, patch));
    } finally {
      setSaving(false);
    }
  }

  if (collapsed) {
    return (
      <div className="flex items-center gap-2.5 border-t border-border-subtle py-2.5 first:border-t-0">
        <span className="w-3.5 flex-none text-center font-mono text-[11px] text-text-tertiary">{index}</span>
        <p className="min-w-0 flex-1 truncate text-[13px] font-semibold">{tip.selection ?? "—"}</p>
        <span className="flex-none font-mono text-[12px] font-bold">{tip.odd != null ? tip.odd.toFixed(2) : "—"}</span>
        <span className="flex-none font-mono text-[12px] text-text-tertiary">{tip.unit != null ? `${tip.unit}u` : "—"}</span>
        <span className={`flex-none rounded-md px-2 py-1 font-mono text-[9px] font-bold tracking-[0.03em] ${chip.className}`}>{chip.text}</span>
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
        <input
          value={selection}
          onChange={(e) => setSelection(e.target.value)}
          onBlur={() => selection.trim() !== (tip.selection ?? "") && commit({ selection: selection.trim() })}
          placeholder="Mercado/seleção"
          className="min-w-0 flex-1 truncate rounded bg-transparent text-[13px] font-semibold text-text outline-none"
        />
        <span className="flex-none font-mono text-[12px] font-bold">{tip.odd != null ? tip.odd.toFixed(2) : "—"}</span>
        <span className="flex-none font-mono text-[12px] text-text-tertiary">{tip.unit != null ? `${tip.unit}u` : "—"}</span>
        <span className={`flex-none rounded-md px-2 py-1 font-mono text-[9px] font-bold tracking-[0.03em] ${chip.className}`}>
          {saving ? "…" : chip.text}
        </span>
        <button
          onClick={() => setCollapsed(true)}
          aria-label="Ocultar tip"
          className="flex-none self-start rounded-lg border border-border-strong bg-surface-chip p-1.5 text-text-secondary"
        >
          <IconChevronDown size={14} className="rotate-180" />
        </button>
      </div>

      <input
        value={match}
        onChange={(e) => setMatch(e.target.value)}
        onBlur={() => match.trim() !== (tip.match ?? "") && commit({ match: match.trim() || null })}
        placeholder="Jogo (Time A x Time B)"
        className="mb-2.5 w-full rounded-lg border border-border-strong bg-surface-alt px-2.5 py-1.5 text-[12.5px] text-text outline-none"
      />

      <div className="mb-2.5 grid grid-cols-2 gap-2 lg:grid-cols-4">
        <div className="flex flex-col gap-0.5 rounded-[10px] border border-accent-border bg-accent-soft p-2.5">
          <span className="text-[10px] text-text-secondary">Unidade</span>
          <input
            inputMode="decimal"
            value={unitText}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => setUnitText(e.target.value)}
            onBlur={() => commit({ unit: parseNumber(unitText) })}
            className="w-full rounded bg-transparent font-mono text-[14px] font-bold text-accent outline-none"
          />
        </div>
        <div className="flex flex-col gap-0.5 rounded-[10px] border border-border-subtle bg-surface-chip p-2.5">
          <span className="text-[10px] text-text-secondary">Odd</span>
          <input
            inputMode="decimal"
            value={oddText}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => setOddText(e.target.value)}
            onBlur={() => commit({ odd: parseNumber(oddText) })}
            className="w-full rounded bg-transparent font-mono text-[14px] font-bold outline-none"
          />
        </div>
        <div className="flex flex-col gap-0.5 rounded-[10px] border border-border-subtle bg-surface-chip p-2.5">
          <span className="text-[10px] text-text-secondary">Casa</span>
          <BookmakerCombobox
            value={tip.bookmaker}
            options={bookmakers}
            included={tip.bookmakerOptions ?? []}
            onChange={(raw, url) => commit(url !== undefined ? { bookmaker: raw, betUrl: url } : { bookmaker: raw })}
          />
        </div>
        <div className="flex flex-col gap-0.5 rounded-[10px] border border-border-subtle bg-surface-chip p-2.5">
          <span className="text-[10px] text-text-secondary">Link</span>
          <input
            value={betUrl}
            onChange={(e) => setBetUrl(e.target.value)}
            onBlur={() => betUrl.trim() !== (tip.betUrl ?? "") && commit({ betUrl: betUrl.trim() || null })}
            placeholder="https://…"
            className="w-full truncate rounded bg-transparent text-[12px] text-text outline-none"
          />
        </div>
      </div>

      <div className="mb-2.5 flex gap-1.5">
        {RESULT_BUTTONS.map((r) => (
          <button
            key={r.key}
            onClick={() => commit({ result: r.key })}
            className={`flex-1 rounded-lg py-1.5 text-[11px] font-semibold ${
              tip.result === r.key ? r.activeClassName : "bg-surface-chip text-text-tertiary"
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      <a
        href={betActive ? tip.betUrl! : undefined}
        target={betActive ? "_blank" : undefined}
        rel="noreferrer"
        onClick={(e) => {
          if (!betActive) e.preventDefault();
        }}
        aria-disabled={!betActive}
        className={`flex h-9 items-center justify-center gap-1.5 rounded-lg text-[12px] font-bold ${
          betActive ? "bg-accent text-[#08090A]" : "cursor-not-allowed bg-surface-alt text-text-tertiary"
        }`}
      >
        {betActive ? `Abrir na ${bookmakerLabel(tip.bookmaker)}` : "Sem link"} <IconExternalLink size={11} />
      </a>
    </div>
  );
}

function AdminMessageGroupCard({
  group,
  bookmakers,
  photoVisible,
  onTogglePhoto,
  onOpenPhoto,
  onUpdate,
}: {
  group: MessageGroup;
  bookmakers: string[];
  photoVisible: boolean;
  onTogglePhoto: (key: string, visible: boolean) => void;
  onOpenPhoto: (url: string) => void;
  onUpdate: (tip: TelegramTip) => void;
}) {
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
          {group.tips.length} {group.tips.length === 1 ? "tip" : "tips"}
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
              <AdminTipRow key={tip.id} tip={tip} index={i + 1} bookmakers={bookmakers} onUpdate={onUpdate} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function AdminTelegramTipsPage() {
  const navigate = useNavigate();
  const [groups, setGroups] = useState<TelegramGroup[]>([]);
  const [bookmakers, setBookmakers] = useState<string[]>([]);
  const [groupId, setGroupId] = useState("");
  const [bookmaker, setBookmaker] = useState("");
  const [result, setResult] = useState("");
  const [search, setSearch] = useState("");
  const [missing, setMissing] = useState<string[]>([]);
  const [retrying, setRetrying] = useState(false);
  const [retryMessage, setRetryMessage] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [tips, setTips] = useState<TelegramTip[] | null>(null);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [photoOverrides, setPhotoOverrides] = useState<Record<string, boolean>>({});
  const [photoModal, setPhotoModal] = useState<string | null>(null);

  useEffect(() => {
    fetchTelegramGroups().then(setGroups).catch(() => {});
    fetchBookmakerNames().then(setBookmakers).catch(() => {});
  }, []);

  function load() {
    fetchTelegramTips({
      page,
      limit: PAGE_SIZE,
      groupId: groupId || undefined,
      bookmaker: bookmaker || undefined,
      result: result || undefined,
      search: search || undefined,
      missing: missing.length > 0 ? missing.join(",") : undefined,
    }).then((res) => {
      setTips(res.data);
      setTotal(res.total);
      setTotalPages(res.totalPages);
    });
  }

  useEffect(load, [page, groupId, bookmaker, result, search, missing]);
  useEffect(() => setPage(1), [groupId, bookmaker, result, search, missing]);

  function toggleMissing(key: string) {
    setMissing((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }

  function updateTip(updated: TelegramTip) {
    setTips((prev) => prev?.map((t) => (t.id === updated.id ? updated : t)) ?? prev);
  }

  function togglePhoto(key: string, visible: boolean) {
    setPhotoOverrides((prev) => ({ ...prev, [key]: visible }));
  }

  const groupedList = groupTipsByMessage(tips ?? []);

  const body = (
    <div className="flex flex-col gap-3">
      <div className="rounded-2xl border border-border bg-surface p-4">
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar jogo/mercado…"
            className="w-full max-w-[220px] rounded-lg border border-border-strong bg-surface-alt px-3 py-2 text-[13px] text-text outline-none"
          />
          <Dropdown
            value={groupId}
            onChange={setGroupId}
            placeholder="Todos os grupos"
            options={groups.map((g) => ({ value: g.id, label: g.name }))}
            className="w-auto flex-none"
          />
          <Dropdown
            value={bookmaker}
            onChange={setBookmaker}
            placeholder="Todas as casas"
            options={bookmakers.map((b) => ({ value: b, label: bookmakerLabel(b) }))}
            className="w-auto flex-none"
          />
          <Dropdown
            value={result}
            onChange={setResult}
            placeholder="Todos os resultados"
            options={RESULT_BUTTONS.map((r) => ({ value: r.key, label: r.label }))}
            className="w-auto flex-none"
          />
          <span className="ml-auto flex-none font-mono text-[12px] text-text-tertiary">{total} tip(s)</span>
        </div>
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {MISSING_FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => toggleMissing(f.key)}
              className={`flex-none rounded-full px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.02em] ${
                missing.includes(f.key) ? "bg-live/10 font-bold text-live" : "bg-surface-chip text-text-secondary"
              }`}
            >
              {f.label}
            </button>
          ))}
          <button
            onClick={async () => {
              setRetrying(true);
              setRetryMessage(null);
              try {
                const res = await retryMissingOcr();
                setRetryMessage(`${res.tipsEnqueued} tip(s) em ${res.groupsEnqueued} foto(s) reenfileiradas — pode levar alguns minutos.`);
              } finally {
                setRetrying(false);
              }
            }}
            disabled={retrying}
            className="ml-auto flex-none rounded-full bg-accent-soft px-3.5 py-1.5 font-mono text-[11px] font-bold uppercase tracking-[0.02em] text-accent disabled:opacity-50"
          >
            {retrying ? "Reenfileirando…" : "Reprocessar OCR (faltando)"}
          </button>
        </div>
        {retryMessage && <p className="mt-2 text-[12px] text-text-tertiary">{retryMessage}</p>}
      </div>

      {tips === null && <p className="py-10 text-center text-sm text-text-tertiary">Carregando…</p>}
      {tips?.length === 0 && <p className="py-10 text-center text-sm text-text-tertiary">Nenhuma tip encontrada.</p>}

      {groupedList.map((group) => (
        <AdminMessageGroupCard
          key={group.key}
          group={group}
          bookmakers={bookmakers}
          photoVisible={photoOverrides[group.key] ?? true}
          onTogglePhoto={togglePhoto}
          onOpenPhoto={setPhotoModal}
          onUpdate={updateTip}
        />
      ))}

      {totalPages > 1 && (
        <div className="flex items-center justify-between rounded-2xl border border-border bg-surface px-4 py-3">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="rounded-lg border border-border-strong px-3 py-1.5 text-[12.5px] disabled:opacity-40"
          >
            Anterior
          </button>
          <span className="font-mono text-[12px] text-text-tertiary">
            página {page} de {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="rounded-lg border border-border-strong px-3 py-1.5 text-[12.5px] disabled:opacity-40"
          >
            Próxima
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div className="min-h-dvh bg-bg text-text lg:flex lg:min-h-full lg:flex-col">
      {/* ---------- Desktop ---------- */}
      <div className="hidden lg:flex lg:h-[70px] lg:flex-none lg:items-center lg:gap-3 lg:border-b lg:border-border lg:px-8">
        <Link to="/admin" className="text-[13px] text-text-tertiary hover:text-text">
          Admin
        </Link>
        <span className="text-text-tertiary">/</span>
        <span className="text-[20px] font-bold tracking-[-0.02em]">VIP Telegram · Tips oficiais</span>
      </div>

      <div className="hidden lg:block lg:flex-1 lg:overflow-y-auto lg:px-8 lg:py-6">{body}</div>

      {/* ---------- Mobile ---------- */}
      <div className="pb-8 lg:hidden">
        <div className="flex items-center gap-3.5 border-b border-border px-4 pb-3.5 pt-14">
          <button onClick={() => navigate(-1)} aria-label="Voltar">
            <IconChevronLeft size={22} />
          </button>
          <span className="text-[16px] font-semibold">VIP Telegram · Tips oficiais</span>
        </div>
        <div className="p-4">{body}</div>
      </div>

      <Modal open={photoModal !== null} onClose={() => setPhotoModal(null)} widthClassName="max-w-2xl">
        {photoModal && <img src={photoModal} alt="Bilhete" className="w-full rounded-2xl" />}
      </Modal>
    </div>
  );
}
