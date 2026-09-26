import { useEffect, useState, type ClipboardEvent } from "react";
import {
  createManualTelegramTip,
  createTelegramGroup,
  patchTelegramTip,
  patchTelegramTipTake,
  TELEGRAM_TIP_MARKET_TYPES,
  type TelegramGroup,
  type TelegramTip,
} from "../../../lib/telegramTips";
import { Modal } from "../../../components/Modal";
import { bookmakerLabel } from "../../../lib/bookmakers";
import { IconX } from "../../../components/Icon";

/*
 * "Adicionar tip" — uma tip que chegou fora dos grupos monitorados (DM, outro
 * chat, print de alguém). Vira uma tip oficial comum, marcada como "manual";
 * a aposta automática nunca pega ela (ver betting-queue).
 * Com `editing`, o mesmo formulário edita uma tip existente (foto incluída).
 */

const PHOTO_MAX_SIDE = 1600;
const PHOTO_QUALITY = 0.85;

/** Reduz a foto no navegador (lado maior ≤ 1600px, JPEG) antes de subir — print
 * de celular chega a vários MB e a OCR não precisa disso tudo. */
async function shrinkPhoto(file: Blob): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, PHOTO_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", PHOTO_QUALITY);
}

/** "2,5" / "2.5" → 2.5; vazio → null; texto ou ≤ 0 → NaN (inválido). */
function parseOptionalNumber(raw: string): number | null {
  const trimmed = raw.trim().replace(",", ".");
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) && n > 0 ? n : NaN;
}

/** Data no formato do <input type="datetime-local"> (hora local). */
function toLocalInput(date: Date): string {
  const d = new Date(date);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}
const nowLocalInput = () => toLocalInput(new Date());
const numText = (v: number | null) => (v === null ? "" : String(v));

const NEW_GROUP = "__novo__";

function saveErrorMessage(err: unknown): string {
  const code = err instanceof Error ? err.message : "";
  if (code === "photo_too_large") return "Foto grande demais.";
  if (code === "invalid_photo") return "Formato de foto não suportado (use JPG, PNG ou WebP).";
  if (code === "only_manual_tips") return "Grupo e data só mudam em tip adicionada à mão.";
  return "Não consegui salvar a tip.";
}

const labelClass = "mb-1.5 block font-mono text-[11px] font-semibold tracking-[0.05em] text-text-secondary";
const inputClass =
  "h-10 w-full rounded-[10px] border border-border-strong bg-surface px-3 text-[13px] text-text outline-none focus:border-accent";

export function TipFormModal({
  open,
  editing = null,
  onClose,
  onSaved,
  onGroupCreated,
  groups,
  bookmakers,
}: {
  open: boolean;
  /** Tip sendo editada — null = adicionar uma nova. */
  editing?: TelegramTip | null;
  onClose: () => void;
  onSaved: (tip: TelegramTip) => void;
  onGroupCreated: (group: TelegramGroup) => void;
  groups: TelegramGroup[];
  bookmakers: string[];
}) {
  // Grupo e hora identificam a mensagem de origem de uma tip do Telegram — só
  // a manual deixa mudar (a API recusa o resto).
  const canMoveTip = !editing || editing.parsePattern === "manual";
  const [photo, setPhoto] = useState<string | null>(null);
  const [photoRemoved, setPhotoRemoved] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [groupId, setGroupId] = useState("");
  const [newGroupName, setNewGroupName] = useState("");
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [groupError, setGroupError] = useState<string | null>(null);
  const [match, setMatch] = useState("");
  const [selection, setSelection] = useState("");
  const [marketType, setMarketType] = useState("");
  const [odd, setOdd] = useState("");
  const [unit, setUnit] = useState("1");
  const [limit, setLimit] = useState("");
  const [bookmaker, setBookmaker] = useState("");
  const [betUrl, setBetUrl] = useState("");
  const [receivedAt, setReceivedAt] = useState(nowLocalInput);
  const [rawMessage, setRawMessage] = useState("");
  const [taken, setTaken] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Abrir começa do zero (ou dos valores da tip editada).
  useEffect(() => {
    if (!open) return;
    setPhoto(null);
    setPhotoRemoved(false);
    setPhotoError(null);
    setNewGroupName("");
    setGroupError(null);
    setGroupId(editing?.groupId ?? "");
    setMatch(editing?.match ?? "");
    setSelection(editing?.selection ?? "");
    setMarketType(editing?.marketType ?? "");
    setOdd(editing ? numText(editing.odd) : "");
    setUnit(editing ? numText(editing.unit) : "1");
    setLimit(editing ? numText(editing.limit) : "");
    setBookmaker(editing?.bookmaker ?? "");
    setBetUrl(editing?.betUrl ?? "");
    setReceivedAt(editing ? toLocalInput(new Date(editing.receivedAt)) : nowLocalInput());
    setRawMessage(editing?.rawMessage ?? "");
    setTaken(true);
    setError(null);
  }, [open, editing]);

  const existingPhotoUrl = editing?.photoUrl && !photoRemoved ? editing.photoUrl : null;
  const shownPhoto = photo ?? existingPhotoUrl;

  async function pickPhoto(file: Blob | null | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setPhotoError("Isso não é uma imagem.");
      return;
    }
    setPhotoError(null);
    try {
      setPhoto(await shrinkPhoto(file));
    } catch {
      setPhotoError("Não consegui ler essa imagem.");
    }
  }

  // Ctrl+V de um print em qualquer lugar do formulário cola a foto.
  function onPaste(e: ClipboardEvent<HTMLDivElement>) {
    const item = [...e.clipboardData.items].find((i) => i.type.startsWith("image/"));
    if (!item) return;
    e.preventDefault();
    void pickPhoto(item.getAsFile());
  }

  async function addGroup() {
    const name = newGroupName.trim();
    if (!name) return setGroupError("Dê um nome pro grupo.");
    if (groups.some((g) => g.name.toLowerCase() === name.toLowerCase())) return setGroupError("Já existe um grupo com esse nome.");
    setCreatingGroup(true);
    setGroupError(null);
    try {
      const group = await createTelegramGroup({ name });
      onGroupCreated(group);
      setGroupId(group.id);
      setNewGroupName("");
    } catch {
      setGroupError("Não consegui criar o grupo.");
    } finally {
      setCreatingGroup(false);
    }
  }

  async function submit() {
    const unitValue = parseOptionalNumber(unit);
    const oddValue = parseOptionalNumber(odd);
    const limitValue = parseOptionalNumber(limit);
    if (!groupId || groupId === NEW_GROUP) return setError("Escolha o grupo.");
    if (editing) return submitEdit(editing, unitValue, oddValue, limitValue);
    if (unitValue === null || Number.isNaN(unitValue)) return setError("Unidade inválida.");
    if (Number.isNaN(oddValue)) return setError("Odd inválida.");
    if (Number.isNaN(limitValue)) return setError("Limite inválido.");
    if (!photo && oddValue === null) return setError("Sem foto, a odd é obrigatória (não tem de onde a OCR tirar).");
    const url = betUrl.trim();
    if (url && !/^https?:\/\//i.test(url)) return setError("O link precisa começar com http(s)://");
    const when = new Date(receivedAt);
    if (Number.isNaN(when.getTime())) return setError("Data inválida.");

    setSaving(true);
    setError(null);
    try {
      let tip = await createManualTelegramTip({
        groupId,
        match: match.trim() || null,
        selection: selection.trim() || null,
        marketType: (marketType || null) as TelegramTip["marketType"],
        odd: oddValue,
        unit: unitValue,
        limit: limitValue,
        bookmaker: bookmaker.trim() || null,
        betUrl: url || null,
        receivedAt: when.toISOString(),
        rawMessage: rawMessage.trim() || null,
        photoBase64: photo ? photo.slice(photo.indexOf(",") + 1) : null,
      });
      if (taken) {
        tip = await patchTelegramTipTake(tip.id, {
          takenStatus: "taken",
          unit: unitValue,
          ...(oddValue !== null ? { odd: oddValue } : {}),
          ...(tip.bookmaker ? { bookmaker: tip.bookmaker } : {}),
        });
      }
      onSaved(tip);
      onClose();
    } catch (err) {
      setError(saveErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  /** Manda só o que mudou — a tip oficial é a mesma pra todo mundo. */
  async function submitEdit(tip: TelegramTip, unitValue: number | null, oddValue: number | null, limitValue: number | null) {
    if (Number.isNaN(unitValue)) return setError("Unidade inválida.");
    if (Number.isNaN(oddValue)) return setError("Odd inválida.");
    if (Number.isNaN(limitValue)) return setError("Limite inválido.");
    const url = betUrl.trim();
    if (url && !/^https?:\/\//i.test(url)) return setError("O link precisa começar com http(s)://");
    const when = new Date(receivedAt);
    if (Number.isNaN(when.getTime())) return setError("Data inválida.");

    const patch: Parameters<typeof patchTelegramTip>[1] = {};
    if (match.trim() !== (tip.match ?? "")) patch.match = match.trim() || null;
    // Mercado não pode ficar vazio pela API — apagar o texto só não muda nada.
    if (selection.trim() && selection.trim() !== (tip.selection ?? "")) patch.selection = selection.trim();
    if ((marketType || null) !== tip.marketType) patch.marketType = (marketType || null) as TelegramTip["marketType"];
    if (oddValue !== tip.odd) patch.odd = oddValue;
    if (unitValue !== tip.unit) patch.unit = unitValue;
    if (limitValue !== tip.limit) patch.limit = limitValue;
    if ((bookmaker.trim() || null) !== tip.bookmaker) patch.bookmaker = bookmaker.trim() || null;
    if ((url || null) !== tip.betUrl) patch.betUrl = url || null;
    if ((rawMessage.trim() || null) !== (tip.rawMessage?.trim() || null)) patch.rawMessage = rawMessage.trim() || null;
    if (photo) patch.photoBase64 = photo.slice(photo.indexOf(",") + 1);
    else if (photoRemoved && tip.photoUrl) patch.photoBase64 = null;
    if (canMoveTip) {
      if (groupId !== tip.groupId) patch.groupId = groupId;
      if (toLocalInput(when) !== toLocalInput(new Date(tip.receivedAt))) patch.receivedAt = when.toISOString();
    }

    if (Object.keys(patch).length === 0) return onClose();
    setSaving(true);
    setError(null);
    try {
      onSaved(await patchTelegramTip(tip.id, patch));
      onClose();
    } catch (err) {
      setError(saveErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={saving ? () => {} : onClose} widthClassName="max-w-2xl">
      <div onPaste={onPaste} className="flex flex-col gap-4 p-5">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[16px] font-bold">{editing ? "Editar tip" : "Adicionar tip"}</div>
            <div className="text-[12px] text-text-secondary">
              {editing
                ? "Muda a tip oficial — vale pra todo mundo que acompanha ela."
                : "Tip que chegou fora dos grupos (DM, outro chat, print)."}
            </div>
          </div>
          <button onClick={onClose} aria-label="Fechar" className="text-text-tertiary hover:text-text">
            <IconX size={16} />
          </button>
        </div>

        <div>
          <span className={labelClass}>FOTO DO BILHETE</span>
          {shownPhoto ? (
            <div className="relative w-fit">
              <img src={shownPhoto} alt="Bilhete" className="max-h-[260px] rounded-[10px] border border-border" />
              <button
                onClick={() => {
                  if (photo) setPhoto(null);
                  else setPhotoRemoved(true);
                }}
                aria-label="Remover foto"
                className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/70 text-white"
              >
                <IconX size={12} />
              </button>
            </div>
          ) : (
            <label className="flex h-[92px] cursor-pointer flex-col items-center justify-center gap-1 rounded-[10px] border border-dashed border-border-strong bg-surface text-[13px] text-text-secondary hover:border-accent">
              <span className="font-semibold text-text">Escolher imagem</span>
              <span className="text-[12px]">ou cole um print com Ctrl+V</span>
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  void pickPhoto(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </label>
          )}
          {photoError && <p className="mt-1.5 text-[12px] text-live">{photoError}</p>}
          <p className="mt-1.5 text-[12px] text-text-tertiary">
            {editing
              ? "Trocar ou remover a foto vale pra todas as tips da mesma mensagem. Com foto nova, o que estiver em branco a OCR preenche."
              : "Com foto, odd/jogo/mercado podem ficar em branco — a OCR preenche em alguns minutos."}
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <span className={labelClass}>GRUPO *</span>
            <select
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
              disabled={!canMoveTip}
              title={canMoveTip ? undefined : "Tip do Telegram: o grupo é o da mensagem de origem"}
              className={`${inputClass} disabled:opacity-60`}
            >
              <option value="" disabled>
                Escolha o grupo
              </option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
              <option value={NEW_GROUP}>+ Novo grupo…</option>
            </select>
            {groupId === NEW_GROUP && (
              <div className="mt-2">
                <div className="flex gap-2">
                  <input
                    autoFocus
                    value={newGroupName}
                    onChange={(e) => setNewGroupName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void addGroup();
                      }
                    }}
                    placeholder="Nome do grupo"
                    className={inputClass}
                  />
                  <button
                    onClick={() => void addGroup()}
                    disabled={creatingGroup}
                    className="h-10 flex-none rounded-[10px] bg-accent px-3.5 text-[12px] font-bold text-[#08090A] disabled:opacity-60"
                  >
                    {creatingGroup ? "Criando…" : "Criar"}
                  </button>
                </div>
                <p className={`mt-1.5 text-[11px] ${groupError ? "text-live" : "text-text-tertiary"}`}>
                  {groupError ?? "Grupo só pra tips adicionadas à mão — o Evobo não escuta nenhum chat do Telegram por ele."}
                </p>
              </div>
            )}
          </div>
          <div>
            <span className={labelClass}>DATA E HORA</span>
            <input
              type="datetime-local"
              value={receivedAt}
              onChange={(e) => setReceivedAt(e.target.value)}
              disabled={!canMoveTip}
              title={canMoveTip ? undefined : "Tip do Telegram: a hora é a da mensagem de origem"}
              className={`${inputClass} disabled:opacity-60`}
            />
          </div>
          <div>
            <span className={labelClass}>JOGO</span>
            <input value={match} onChange={(e) => setMatch(e.target.value)} placeholder="Flamengo x Palmeiras" className={inputClass} />
          </div>
          <div>
            <span className={labelClass}>MERCADO</span>
            <input value={selection} onChange={(e) => setSelection(e.target.value)} placeholder="Mais de 2.5 gols" className={inputClass} />
          </div>
          <div>
            <span className={labelClass}>TIPO DE MERCADO</span>
            <select value={marketType} onChange={(e) => setMarketType(e.target.value)} className={inputClass}>
              <option value="">— (a OCR classifica)</option>
              {TELEGRAM_TIP_MARKET_TYPES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
          <div>
            <span className={labelClass}>CASA</span>
            <input
              value={bookmaker}
              onChange={(e) => setBookmaker(e.target.value)}
              list="manual-tip-bookmakers"
              placeholder="betano"
              className={inputClass}
            />
            <datalist id="manual-tip-bookmakers">
              {bookmakers.map((b) => (
                <option key={b} value={b}>
                  {bookmakerLabel(b)}
                </option>
              ))}
            </datalist>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <span className={labelClass}>UNIDADE{editing ? "" : " *"}</span>
            <input value={unit} onChange={(e) => setUnit(e.target.value)} inputMode="decimal" placeholder="1" className={`${inputClass} font-mono`} />
          </div>
          <div>
            <span className={labelClass}>ODD</span>
            <input value={odd} onChange={(e) => setOdd(e.target.value)} inputMode="decimal" placeholder="1.85" className={`${inputClass} font-mono`} />
          </div>
          <div>
            <span className={labelClass}>LIMITE (R$)</span>
            <input value={limit} onChange={(e) => setLimit(e.target.value)} inputMode="decimal" placeholder="—" className={`${inputClass} font-mono`} />
          </div>
        </div>

        <div>
          <span className={labelClass}>LINK DA APOSTA</span>
          <input value={betUrl} onChange={(e) => setBetUrl(e.target.value)} placeholder="https://…" className={inputClass} />
        </div>

        <div>
          <span className={labelClass}>TEXTO DA MENSAGEM</span>
          <textarea
            value={rawMessage}
            onChange={(e) => setRawMessage(e.target.value)}
            rows={3}
            placeholder="Opcional — cole a mensagem original"
            className="w-full rounded-[10px] border border-border-strong bg-surface px-3 py-2 text-[13px] text-text outline-none focus:border-accent"
          />
        </div>

        {!editing && (
          <label className="flex cursor-pointer items-center gap-2.5 text-[13px]">
            <input type="checkbox" checked={taken} onChange={(e) => setTaken(e.target.checked)} className="h-4 w-4 accent-[var(--color-accent)]" />
            Marcar como <b>peguei</b> (entra na minha banca com essa unidade e odd)
          </label>
        )}

        {error && <p className="text-[12px] text-live">{error}</p>}

        <div className="flex justify-end gap-2.5">
          <button onClick={onClose} disabled={saving} className="h-10 rounded-[10px] border border-border-strong px-4 text-[13px] font-semibold">
            Cancelar
          </button>
          <button
            onClick={() => void submit()}
            disabled={saving}
            className="h-10 rounded-[10px] bg-accent px-5 text-[13px] font-bold text-[#08090A] disabled:opacity-60"
          >
            {saving ? "Salvando…" : editing ? "Salvar" : "Adicionar tip"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
