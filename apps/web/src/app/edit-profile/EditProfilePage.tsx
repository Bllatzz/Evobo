import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError } from "../../lib/api";
import { updateMyProfile, uploadAvatar } from "../../lib/profile";
import { Avatar } from "../../components/Avatar";
import { IconCamera, IconChevronLeft } from "../../components/Icon";
import { useAuth } from "../../stores/auth";

const SPORT_OPTIONS = ["Futebol", "Basquete", "Tênis", "NFL", "eSports"];
const USERNAME_PATTERN = /^[a-z0-9]+$/;

export function EditProfilePage() {
  const navigate = useNavigate();
  const { me, refreshMe } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [displayName, setDisplayName] = useState(me?.displayName ?? "");
  const [username, setUsername] = useState(me?.username ?? "");
  const [bio, setBio] = useState(me?.bio ?? "");
  const [favoriteSports, setFavoriteSports] = useState<string[]>(me?.favoriteSports ?? []);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(me?.avatarUrl ?? null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!me) return null;

  const usernameValid = username.length >= 3 && username.length <= 30 && USERNAME_PATTERN.test(username);

  function handleUsernameChange(e: React.ChangeEvent<HTMLInputElement>) {
    setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, ""));
  }

  function toggleSport(sport: string) {
    setFavoriteSports((prev) =>
      prev.includes(sport) ? prev.filter((s) => s !== sport) : [...prev, sport],
    );
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPendingFile(file);
    setAvatarPreview(URL.createObjectURL(file));
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      let avatarUrl: string | undefined;
      if (pendingFile) {
        avatarUrl = await uploadAvatar(me!.id, pendingFile);
      }
      await updateMyProfile({
        displayName,
        username,
        bio: bio.trim() === "" ? null : bio,
        favoriteSports,
        ...(avatarUrl && { avatarUrl }),
      });
      await refreshMe();
      navigate(-1);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError("Esse nome de usuário já está em uso.");
      } else {
        setError("Não deu pra salvar. Tenta de novo.");
      }
    } finally {
      setSaving(false);
    }
  }

  const sportsField = (
    <div>
      <span className="mb-2 block font-mono text-[11px] tracking-[0.04em] text-text-secondary">
        ESPORTES FAVORITOS
      </span>
      <div className="flex flex-wrap gap-2">
        {SPORT_OPTIONS.map((sport) => {
          const active = favoriteSports.includes(sport);
          return (
            <button
              key={sport}
              type="button"
              onClick={() => toggleSport(sport)}
              className={`rounded-[11px] px-3.5 py-2 text-[13px] font-semibold ${
                active
                  ? "border border-accent bg-accent-soft text-accent"
                  : "border border-border-strong bg-surface-alt text-text-secondary"
              }`}
            >
              {sport}
            </button>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="min-h-dvh bg-bg text-text lg:flex lg:min-h-full lg:flex-col">
      {/* ---------- Desktop ---------- */}
      <div className="hidden lg:flex lg:h-[70px] lg:flex-none lg:items-center lg:border-b lg:border-border lg:px-8">
        <span className="text-[20px] font-bold tracking-[-0.02em]">Editar perfil</span>
        <button
          onClick={handleSave}
          disabled={saving || displayName.trim() === "" || !usernameValid}
          className="ml-auto rounded-[11px] bg-accent px-5 py-2.5 text-[14px] font-bold text-[#08090A] disabled:opacity-50"
        >
          {saving ? "Salvando…" : "Salvar"}
        </button>
      </div>

      <div className="hidden lg:flex lg:flex-1 lg:gap-10 lg:px-8 lg:py-[30px]">
        <div className="flex w-[220px] flex-none flex-col items-center gap-3.5">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="relative"
            aria-label="Alterar foto"
          >
            <Avatar name={displayName || me.displayName} seed={me.id} src={avatarPreview} size={120} />
            <span className="absolute bottom-0.5 right-0.5 flex h-[38px] w-[38px] items-center justify-center rounded-full border-2 border-bg bg-surface-alt text-accent">
              <IconCamera size={18} />
            </span>
          </button>
          <span className="text-[13px] font-semibold text-accent">Alterar foto</span>
          <span className="text-center font-mono text-[11px] leading-relaxed text-text-tertiary">
            JPG ou PNG
            <br />
            máx. 4MB
          </span>
        </div>

        <div className="flex max-w-[620px] flex-1 flex-col gap-4.5">
          <div className="flex gap-4">
            <label className="flex-1">
              <span className="mb-2 block font-mono text-[11px] tracking-[0.04em] text-text-secondary">
                NOME
              </span>
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                maxLength={60}
                className="h-[52px] w-full rounded-[14px] border border-border-strong bg-surface-input px-4 text-[15px] text-text outline-none focus:border-accent"
              />
            </label>
            <label className="flex-1">
              <span className="mb-2 block font-mono text-[11px] tracking-[0.04em] text-text-secondary">
                USUÁRIO
              </span>
              <div
                className={`flex h-[52px] w-full items-center gap-1.5 rounded-[14px] border bg-surface-input px-4 text-[15px] text-text focus-within:border-accent ${
                  usernameValid ? "border-border-strong" : "border-live"
                }`}
              >
                <span className="text-text-tertiary">@</span>
                <input
                  value={username}
                  onChange={handleUsernameChange}
                  maxLength={30}
                  className="w-full bg-transparent outline-none"
                />
              </div>
            </label>
          </div>

          <label className="block">
            <span className="mb-2 block font-mono text-[11px] tracking-[0.04em] text-text-secondary">
              BIO
            </span>
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              maxLength={280}
              rows={3}
              className="min-h-[88px] w-full resize-none rounded-[14px] border border-border-strong bg-surface-input px-4 py-3.5 text-[15px] leading-relaxed text-text outline-none focus:border-accent"
            />
          </label>

          {sportsField}

          {error && <p className="text-sm text-live">{error}</p>}
        </div>
      </div>

      {/* ---------- Mobile ---------- */}
      <div className="pb-8 lg:hidden">
      <div className="flex items-center justify-between px-5 pb-4 pt-14">
        <button onClick={() => navigate(-1)} aria-label="Voltar">
          <IconChevronLeft />
        </button>
        <span className="text-[16px] font-bold">Editar perfil</span>
        <button
          onClick={handleSave}
          disabled={saving || displayName.trim() === "" || !usernameValid}
          className="text-[14px] font-bold text-accent disabled:opacity-50"
        >
          {saving ? "Salvando…" : "Salvar"}
        </button>
      </div>

      <div className="flex flex-col items-center gap-2.5 px-5 pb-5 pt-1">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="relative"
          aria-label="Alterar foto"
        >
          <Avatar name={displayName || me.displayName} seed={me.id} src={avatarPreview} size={82} />
          <span className="absolute -bottom-0.5 -right-0.5 flex h-[30px] w-[30px] items-center justify-center rounded-full border-2 border-bg bg-surface-alt text-accent">
            <IconCamera size={15} />
          </span>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={handleFileChange}
        />
        <span className="text-[12px] font-semibold text-accent">Alterar foto</span>
      </div>

      <div className="flex flex-col gap-3.5 px-5">
        <label className="block">
          <span className="mb-2 block font-mono text-[11px] tracking-[0.04em] text-text-secondary">
            NOME
          </span>
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={60}
            className="h-[50px] w-full rounded-[14px] border border-border-strong bg-surface-input px-[15px] text-[15px] text-text outline-none focus:border-accent"
          />
        </label>

        <label className="block">
          <span className="mb-2 block font-mono text-[11px] tracking-[0.04em] text-text-secondary">
            USUÁRIO
          </span>
          <div
            className={`flex h-[50px] w-full items-center gap-1.5 rounded-[14px] border bg-surface-input px-[15px] text-[15px] text-text focus-within:border-accent ${
              usernameValid ? "border-border-strong" : "border-live"
            }`}
          >
            <span className="text-text-tertiary">@</span>
            <input
              value={username}
              onChange={handleUsernameChange}
              maxLength={30}
              className="w-full bg-transparent outline-none"
            />
          </div>
        </label>

        <label className="block">
          <span className="mb-2 block font-mono text-[11px] tracking-[0.04em] text-text-secondary">
            BIO
          </span>
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            maxLength={280}
            rows={3}
            className="min-h-[74px] w-full resize-none rounded-[14px] border border-border-strong bg-surface-input px-[15px] py-3 text-[14px] leading-relaxed text-text outline-none focus:border-accent"
          />
        </label>

        {sportsField}

        {error && <p className="text-sm text-live">{error}</p>}
      </div>
      </div>
    </div>
  );
}
