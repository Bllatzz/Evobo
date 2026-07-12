/** The actual Evobo app icon (apps/web/public/evobo-icon.png) — a rounded
 * square tile with its own dark fill baked into the image, so it can be
 * dropped in directly without an extra gradient-tile wrapper. */
export function Logo({
  size = 32,
  rounded = 11,
  className,
}: {
  size?: number;
  rounded?: number;
  className?: string;
}) {
  return (
    <img
      src="/evobo-icon.png"
      alt="Evobo"
      width={size}
      height={size}
      style={{ borderRadius: rounded }}
      className={className}
    />
  );
}
