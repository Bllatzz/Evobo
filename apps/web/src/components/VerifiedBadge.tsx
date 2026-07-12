export function VerifiedBadge({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="#3D9DF6" aria-label="Verificado">
      <circle cx="12" cy="12" r="11" />
      <path
        d="M8 12l3 3 5-6"
        stroke="#fff"
        strokeWidth="2.5"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
