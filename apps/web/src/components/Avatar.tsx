import { avatarGradient, initials } from "../lib/avatar";

export function Avatar({
  name,
  seed,
  src,
  size = 40,
  className = "",
}: {
  name: string;
  seed: string;
  src?: string | null;
  size?: number;
  className?: string;
}) {
  if (src) {
    return (
      <img
        src={src}
        alt=""
        className={`flex-none rounded-full object-cover ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <div
      className={`flex flex-none items-center justify-center rounded-full font-bold text-[#08090A] ${className}`}
      style={{
        width: size,
        height: size,
        background: avatarGradient(seed),
        fontSize: size * 0.38,
      }}
    >
      {initials(name)}
    </div>
  );
}
