import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  fetchTelegramTips,
  fetchTelegramGroups,
  fetchBookmakerNames,
  patchTelegramTip,
  type TelegramTip,
  type TelegramGroup,
} from "../../../lib/telegramTips";
import { Dropdown } from "../../../components/Dropdown";
import { BookmakerCombobox } from "../../../components/BookmakerCombobox";
import { bookmakerLabel } from "../../../lib/bookmakers";
import { IconChevronLeft } from "../../../components/Icon";

const PAGE_SIZE = 30;

const RESULT_BUTTONS = [
  { key: "pending", label: "Pendente", activeClassName: "bg-surface-alt text-text" },
  { key: "green", label: "Green", activeClassName: "bg-accent-soft text-accent" },
  { key: "red", label: "Red", activeClassName: "bg-live/10 text-live" },
  { key: "reembolso", label: "Reemb.", activeClassName: "bg-vip-soft text-vip" },
] as const;

function parseNumber(raw: string): number | null {
  const trimmed = raw.trim().replace(",", ".");
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Uma tip na visão "registro oficial" do admin — cada campo comita direto
 * (blur/seleção), sem estado de rascunho: correção pontual, não um fluxo de
 * revisão em lote como a tela pessoal do VIP Telegram. */
function AdminTipRow({ tip, bookmakers, onUpdate }: { tip: TelegramTip; bookmakers: string[]; onUpdate: (tip: TelegramTip) => void }) {
  const [match, setMatch] = useState(tip.match ?? "");
  const [selection, setSelection] = useState(tip.selection ?? "");
  const [unitText, setUnitText] = useState(tip.unit != null ? String(tip.unit) : "");
  const [oddText, setOddText] = useState(tip.odd != null ? String(tip.odd) : "");
  const [betUrl, setBetUrl] = useState(tip.betUrl ?? "");
  const [saving, setSaving] = useState(false);

  async function commit(patch: Parameters<typeof patchTelegramTip>[1]) {
    setSaving(true);
    try {
      onUpdate(await patchTelegramTip(tip.id, patch));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="border-t border-border-subtle p-3.5 first:border-t-0">
      <div className="mb-2 flex items-center gap-2 text-[11px] text-text-tertiary">
        <span className="truncate">{tip.groupName}</span>
        <span>·</span>
        <span>{new Date(tip.receivedAt).toLocaleString("pt-BR")}</span>
        {saving && <span className="text-accent">salvando…</span>}
      </div>

      <div className="mb-2 grid grid-cols-1 gap-2 lg:grid-cols-2">
        <input
          value={match}
          onChange={(e) => setMatch(e.target.value)}
          onBlur={() => match.trim() !== (tip.match ?? "") && commit({ match: match.trim() || null })}
          placeholder="Jogo (Time A x Time B)"
          className="w-full rounded-lg border border-border-strong bg-surface-alt px-2.5 py-1.5 text-[13px] text-text outline-none"
        />
        <input
          value={selection}
          onChange={(e) => setSelection(e.target.value)}
          onBlur={() => selection.trim() !== (tip.selection ?? "") && commit({ selection: selection.trim() })}
          placeholder="Mercado/seleção"
          className="w-full rounded-lg border border-border-strong bg-surface-alt px-2.5 py-1.5 text-[13px] font-semibold text-text outline-none"
        />
      </div>

      <div className="mb-2 grid grid-cols-2 gap-2 lg:grid-cols-4">
        <div className="flex flex-col gap-0.5 rounded-[10px] border border-border-subtle bg-surface-chip p-2.5">
          <span className="text-[10px] text-text-secondary">Unidade</span>
          <input
            inputMode="decimal"
            value={unitText}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => setUnitText(e.target.value)}
            onBlur={() => commit({ unit: parseNumber(unitText) })}
            className="w-full rounded bg-transparent font-mono text-[14px] font-bold text-text outline-none"
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
            className="w-full rounded bg-transparent font-mono text-[14px] font-bold text-text outline-none"
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

      <div className="flex gap-1.5">
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
  const [page, setPage] = useState(1);
  const [tips, setTips] = useState<TelegramTip[] | null>(null);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

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
    }).then((res) => {
      setTips(res.data);
      setTotal(res.total);
      setTotalPages(res.totalPages);
    });
  }

  useEffect(load, [page, groupId, bookmaker, result, search]);
  useEffect(() => setPage(1), [groupId, bookmaker, result, search]);

  const body = (
    <div className="rounded-2xl border border-border bg-surface">
      <div className="flex flex-wrap items-center gap-2 p-4">
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

      <div className="border-t border-border">
        {tips === null && <p className="py-8 text-center text-[12.5px] text-text-tertiary">Carregando…</p>}
        {tips?.length === 0 && <p className="py-8 text-center text-[12.5px] text-text-tertiary">Nenhuma tip encontrada.</p>}
        {tips?.map((tip) => (
          <AdminTipRow
            key={tip.id}
            tip={tip}
            bookmakers={bookmakers}
            onUpdate={(updated) => setTips((prev) => prev?.map((t) => (t.id === updated.id ? updated : t)) ?? prev)}
          />
        ))}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-border px-4 py-3">
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
    </div>
  );
}
