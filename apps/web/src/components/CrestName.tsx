import type { SyntheticEvent } from "react";

const NOT_FOUND_CREST = "https://robotip.com.br/robotip_imgs/teams_imgs/not-found.png";

export function onCrestError(e: SyntheticEvent<HTMLImageElement>) {
  e.currentTarget.src = NOT_FOUND_CREST;
}

export function CrestName({ src, name }: { src: string; name: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <img
        src={src}
        onError={onCrestError}
        alt=""
        className="h-4 w-4 flex-none rounded-full bg-surface-chip object-contain"
      />
      <span className="truncate text-[13px] font-semibold">{name}</span>
    </div>
  );
}
