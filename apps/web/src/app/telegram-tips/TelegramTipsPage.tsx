import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  fetchTelegramTips,
  fetchTelegramGroups,
  fetchTelegramSettings,
  fetchBookmakerNames,
  patchTelegramTip,
  type TelegramTip,
  type TelegramGroup,
} from "../../lib/telegramTips";
import { Modal } from "../../components/Modal";
import { Dropdown } from "../../components/Dropdown";
import { IconTelegram, IconExternalLink, IconCheck, IconX } from "../../components/Icon";
import { useAuth } from "../../stores/auth";

const RESULT_FILTERS = [
  { key: "", label: "Todas" },
  { key: "pending", label: "Pendentes" },
  { key: "green", label: "Green" },
  { key: "red", label: "Red" },
  { key: "reembolso", label: "Reembolso" },
] as const;

const RESULT_BUTTONS = [
  { key: "pending", label: "Pendente" },
  { key: "green", label: "Green" },
  { key: "red", label: "Red" },
  { key: "reembolso", label: "Reemb." },
] as const;

/** Click-to-edit unit/odd — a personal correction (the tipster's original
 * text/photo stays untouched in rawMessage) for cases like an odd dropping
 * before you place the bet: same tip, different real stake/odd for you. */
function EditableValue({
  value,
  format,
  onSave,
  className,
}: {
  value: number | null;
  format: (v: number) => string;
  onSave: (next: number | null) => Promise<void>;
  className: string;
}) {
  const [editing, setEditing] = useState(false);
  const [raw, setRaw] = useState("");

  if (editing) {
    return (
      <input
        autoFocus
        value={raw}
        inputMode="decimal"
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setRaw(e.target.value)}
        onBlur={async () => {
          setEditing(false);
          const trimmed = raw.trim().replace(",", ".");
          const next = trimmed === "" ? null : Number(trimmed);
          if (next !== null && (!Number.isFinite(next) || next <= 0)) return;
          if (next === value) return;
          await onSave(next);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") setEditing(false);
        }}
        className={`w-full rounded bg-transparent outline-none ${className}`}
      />
    );
  }

  return (
    <button
      onClick={() => {
        setRaw(value != null ? String(value) : "");
        setEditing(true);
      }}
      className={`text-left ${className}`}
    >
      {value != null ? format(value) : "—"}
    </button>
  );
}

// Resolvidas antigas têm o detalhe zerado pra economizar espaço (ver
// purgeOldTips no worker) — nunca marcar essas como "revisar".
function needsReview(tip: TelegramTip): boolean {
  if (tip.result !== "pending") return false;
  return tip.parsePattern === null || !tip.selection || tip.selection.trim() === "";
}

export function TipCard({
  tip,
  unitValue,
  onUpdate,
  onOpenPhoto,
}: {
  tip: TelegramTip;
  unitValue: number | null;
  onUpdate: (tip: TelegramTip) => void;
  onOpenPhoto: (url: string) => void;
}) {
  const { me } = useAuth();
  const isAdmin = me?.role === "admin";

  async function setTaken(status: "taken" | "skipped") {
    const next = tip.takenStatus === status ? "pending" : status;
    onUpdate(await patchTelegramTip(tip.id, { takenStatus: next }));
  }

  async function setResult(result: (typeof RESULT_BUTTONS)[number]["key"]) {
    onUpdate(await patchTelegramTip(tip.id, { result }));
  }

  return (
    <div className="rounded-[18px] border border-border bg-surface p-4">
      <div className="mb-2 flex items-center gap-2">
        <IconTelegram size={15} className="flex-none text-accent" />
        <span className="truncate text-[13px] font-semibold text-accent">{tip.groupName}</span>
        {needsReview(tip) && (
          <span className="ml-auto flex-none rounded-full border border-vip-border bg-vip-soft px-2 py-0.5 text-[10px] font-semibold text-vip">
            revisar
          </span>
        )}
      </div>

      <div className="mb-3 text-[15px] font-bold">{tip.match ?? <span className="text-text-tertiary">Jogo não identificado</span>}</div>

      {tip.photoUrl && (
        <button onClick={() => onOpenPhoto(tip.photoUrl!)} className="mb-3 block w-full">
          <img src={tip.photoUrl} alt="Bilhete" className="w-full rounded-xl border border-border-subtle" />
        </button>
      )}

      <div className="mb-3.5 grid grid-cols-3 gap-2">
        <div className="flex flex-col gap-0.5 rounded-[10px] border border-accent-border bg-accent-soft p-2.5">
          <span className="text-[10px] text-text-secondary">Unidade</span>
          <EditableValue
            value={tip.unit}
            format={(v) => `${v}u`}
            className="font-mono text-[14px] font-bold text-accent"
            onSave={async (unit) => onUpdate(await patchTelegramTip(tip.id, { unit }))}
          />
          {tip.unit != null && unitValue != null && (
            <span className="font-mono text-[10px] text-accent/80">
              {(tip.unit * unitValue).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
            </span>
          )}
        </div>
        <div className="col-span-2 flex flex-col gap-0.5 rounded-[10px] border border-border-subtle bg-surface-chip p-2.5">
          <span className="text-[10px] text-text-secondary">Mercado</span>
          {tip.selection ? (
            <ul className="flex flex-col gap-0.5">
              {tip.selection.split("\n").map((market, i, all) => (
                <li key={i} className="text-[13px] font-bold leading-snug">
                  {all.length > 1 && "• "}
                  {market}
                </li>
              ))}
            </ul>
          ) : (
            <span className="text-[13px] font-bold">—</span>
          )}
        </div>
        <div className="col-span-2 flex flex-col gap-0.5 rounded-[10px] border border-border-subtle bg-surface-chip p-2.5">
          <span className="text-[10px] text-text-secondary">Casa</span>
          {tip.bookmakerOptions && tip.bookmakerOptions.length > 1 ? (
            <Dropdown
              value={tip.bookmaker ?? ""}
              placeholder="Escolha a casa"
              options={tip.bookmakerOptions.map((o, i) => ({ value: o.bookmaker ?? "", label: o.bookmaker ?? `casa ${i + 1}` }))}
              onChange={async (bookmaker) => {
                const chosen = tip.bookmakerOptions!.find((o) => o.bookmaker === bookmaker);
                if (!chosen) return;
                onUpdate(await patchTelegramTip(tip.id, { bookmaker: chosen.bookmaker, betUrl: chosen.betUrl }));
              }}
              buttonClassName="rounded-md bg-transparent p-0 text-[13px] font-bold"
            />
          ) : (
            <span className="truncate text-[13px] font-bold capitalize">{tip.bookmaker ?? "—"}</span>
          )}
        </div>
        <div className="flex flex-col gap-0.5 rounded-[10px] border border-border-subtle bg-surface-chip p-2.5">
          <span className="text-[10px] text-text-secondary">Odd</span>
          <EditableValue
            value={tip.odd}
            format={(v) => v.toFixed(2)}
            className="font-mono text-[14px] font-bold"
            onSave={async (odd) => onUpdate(await patchTelegramTip(tip.id, { odd }))}
          />
        </div>
      </div>

      <div className="mb-2.5 flex gap-2">
        <button
          onClick={() => setTaken("taken")}
          className={`flex flex-1 items-center justify-center gap-1 rounded-lg py-1.5 text-[12px] font-semibold ${
            tip.takenStatus === "taken" ? "bg-accent text-[#08090A]" : "bg-surface-chip text-text-secondary"
          }`}
        >
          <IconCheck size={11} /> Peguei
        </button>
        <button
          onClick={() => setTaken("skipped")}
          className={`flex flex-1 items-center justify-center gap-1 rounded-lg py-1.5 text-[12px] font-semibold ${
            tip.takenStatus === "skipped" ? "bg-live text-white" : "bg-surface-chip text-text-secondary"
          }`}
        >
          <IconX size={11} /> Não peguei
        </button>
      </div>

      {isAdmin ? (
        <div className="mb-3.5 flex gap-1.5">
          {RESULT_BUTTONS.map((r) => (
            <button
              key={r.key}
              onClick={() => setResult(r.key)}
              className={`flex-1 rounded-lg py-1.5 text-[11px] font-semibold ${
                tip.result === r.key ? "bg-accent-soft text-accent" : "bg-surface-chip text-text-tertiary"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      ) : (
        <div className="mb-3.5 flex items-center justify-center rounded-lg bg-surface-chip py-1.5 text-[11px] font-semibold text-text-tertiary">
          {RESULT_BUTTONS.find((r) => r.key === tip.result)?.label ?? "Pendente"}
        </div>
      )}

      {tip.betUrl && (
        <a
          href={tip.betUrl}
          target="_blank"
          rel="noreferrer"
          className="flex h-[42px] items-center justify-center gap-1.5 rounded-xl bg-accent text-[14px] font-bold text-[#08090A]"
        >
          Abrir na {tip.bookmaker ?? "casa"} <IconExternalLink size={13} />
        </a>
      )}
    </div>
  );
}

export function TelegramTipsPage() {
  const [tips, setTips] = useState<TelegramTip[] | null>(null);
  const [groups, setGroups] = useState<TelegramGroup[]>([]);
  const [groupId, setGroupId] = useState<string>("");
  const [result, setResultFilter] = useState<string>("");
  const [bookmaker, setBookmaker] = useState<string>("");
  const [bookmakers, setBookmakers] = useState<string[]>([]);
  const [photoModal, setPhotoModal] = useState<string | null>(null);
  const [unitValue, setUnitValue] = useState<number | null>(null);

  useEffect(() => {
    fetchTelegramGroups().then(setGroups).catch(() => {});
    fetchTelegramSettings().then((s) => setUnitValue(s.unitValue)).catch(() => {});
    fetchBookmakerNames().then(setBookmakers).catch(() => {});
  }, []);

  useEffect(() => {
    fetchTelegramTips({ groupId: groupId || undefined, result: result || undefined, bookmaker: bookmaker || undefined, limit: 60 })
      .then((res) => setTips(res.data))
      .catch(() => setTips([]));
  }, [groupId, result, bookmaker]);

  function updateTip(updated: TelegramTip) {
    setTips((prev) => prev?.map((t) => (t.id === updated.id ? updated : t)) ?? prev);
  }

  const reviewCount = useMemo(() => tips?.filter(needsReview).length ?? 0, [tips]);

  return (
    <div className="pb-6 lg:mx-auto lg:max-w-[1100px] lg:px-0 lg:pt-6">
      <div className="flex items-center gap-2.5 px-5 pb-3 pt-3 lg:px-0">
        <IconTelegram size={22} className="text-accent" />
        <span className="text-[20px] font-bold tracking-[-0.02em] lg:text-[22px]">VIP Telegram</span>
        {reviewCount > 0 && (
          <span className="ml-2 rounded-full border border-vip-border bg-vip-soft px-2.5 py-0.5 text-[11px] font-semibold text-vip">
            {reviewCount} pra revisar
          </span>
        )}
        <div className="ml-auto flex flex-none items-center gap-2">
          <Link
            to="/profile"
            className="rounded-[11px] border border-border-strong px-3.5 py-2 text-[13px] font-semibold text-text-secondary"
          >
            Minha banca
          </Link>
          <Link
            to="/telegram-tips/relatorio"
            className="rounded-[11px] border border-border-strong px-3.5 py-2 text-[13px] font-semibold text-text-secondary"
          >
            Relatório
          </Link>
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto px-5 pb-2 lg:px-0">
        <button
          onClick={() => setGroupId("")}
          className={`flex-none rounded-full px-3.5 py-1.5 text-[12px] ${groupId === "" ? "bg-accent font-semibold text-[#08090A]" : "bg-surface-alt text-text-secondary"}`}
        >
          Todos os grupos
        </button>
        {groups.map((g) => (
          <button
            key={g.id}
            onClick={() => setGroupId(g.id)}
            className={`flex-none rounded-full px-3.5 py-1.5 text-[12px] ${groupId === g.id ? "bg-accent font-semibold text-[#08090A]" : "bg-surface-alt text-text-secondary"}`}
          >
            {g.name}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2 px-5 pb-4 lg:px-0">
        <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto">
          {RESULT_FILTERS.map((r) => (
            <button
              key={r.key}
              onClick={() => setResultFilter(r.key)}
              className={`flex-none rounded-full px-3.5 py-1.5 text-[12px] ${result === r.key ? "bg-accent-soft font-semibold text-accent" : "bg-surface-chip text-text-secondary"}`}
            >
              {r.label}
            </button>
          ))}
        </div>
        <Dropdown
          value={bookmaker}
          onChange={setBookmaker}
          placeholder="Todas as casas"
          options={bookmakers.map((b) => ({ value: b, label: b }))}
          className="w-auto flex-none"
        />
      </div>

      <div className="px-4 lg:px-0">
        {tips === null && <p className="py-10 text-center text-sm text-text-tertiary">Carregando…</p>}
        {tips?.length === 0 && <p className="py-10 text-center text-sm text-text-tertiary">Nenhuma tip encontrada.</p>}
        {tips && tips.length > 0 && (
          <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-2">
            {tips.map((tip) => (
              <TipCard key={tip.id} tip={tip} unitValue={unitValue} onUpdate={updateTip} onOpenPhoto={setPhotoModal} />
            ))}
          </div>
        )}
      </div>

      <Modal open={photoModal !== null} onClose={() => setPhotoModal(null)} widthClassName="max-w-2xl">
        {photoModal && <img src={photoModal} alt="Bilhete" className="w-full rounded-2xl" />}
      </Modal>
    </div>
  );
}
