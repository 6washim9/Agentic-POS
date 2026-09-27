type FruitArtProps = {
  kind: string;
  className?: string;
};

const bg: Record<string, string> = {
  apple: "#fecaca",
  mango: "#fde68a",
  banana: "#fef3c7",
  orange: "#fed7aa",
  grape: "#e9d5ff",
  pomegranate: "#fecdd3",
};

export function FruitArt({ kind, className }: FruitArtProps) {
  return (
    <div className={className} style={{ background: bg[kind] ?? "#dcfce7" }} aria-hidden="true">
      <svg viewBox="0 0 120 120" width="88" height="88">
        {kind === "apple" && (
          <>
            <ellipse cx="60" cy="68" rx="32" ry="34" fill="#dc2626" />
            <path d="M60 38c8-14 22-16 24-8" stroke="#15803d" strokeWidth="5" fill="none" />
            <ellipse cx="48" cy="58" rx="7" ry="12" fill="#fecaca" opacity="0.55" />
          </>
        )}
        {kind === "mango" && (
          <>
            <ellipse cx="62" cy="68" rx="28" ry="36" fill="#f59e0b" transform="rotate(-18 62 68)" />
            <path d="M70 34c8 4 12 12 10 18" stroke="#166534" strokeWidth="5" fill="none" />
            <ellipse cx="54" cy="60" rx="8" ry="14" fill="#fde68a" opacity="0.5" />
          </>
        )}
        {kind === "banana" && (
          <>
            <path d="M28 42c18 4 52 8 68 36-22-2-50 2-66 22-2-22 0-44-2-58z" fill="#eab308" />
            <path d="M30 44c16 6 46 10 62 30" stroke="#a16207" strokeWidth="3" fill="none" />
          </>
        )}
        {kind === "orange" && (
          <>
            <circle cx="60" cy="66" r="32" fill="#f97316" />
            <circle cx="60" cy="66" r="24" fill="none" stroke="#fdba74" strokeWidth="2" />
            <path d="M60 34c8 6 4 12 0 12s-8-6 0-12z" fill="#16a34a" />
          </>
        )}
        {kind === "grape" && (
          <>
            <circle cx="48" cy="58" r="12" fill="#7c3aed" />
            <circle cx="66" cy="54" r="12" fill="#6d28d9" />
            <circle cx="58" cy="72" r="12" fill="#5b21b6" />
            <circle cx="76" cy="70" r="11" fill="#7c3aed" />
            <path d="M62 40c6-12 16-14 18-8" stroke="#15803d" strokeWidth="4" fill="none" />
          </>
        )}
        {kind === "pomegranate" && (
          <>
            <circle cx="60" cy="70" r="30" fill="#be123c" />
            <path d="M48 42h24l-6-10h-12z" fill="#9f1239" />
            <circle cx="52" cy="68" r="4" fill="#fecdd3" />
            <circle cx="68" cy="72" r="3.5" fill="#fecdd3" />
            <circle cx="60" cy="80" r="3" fill="#fecdd3" />
          </>
        )}
        {!["apple", "mango", "banana", "orange", "grape", "pomegranate"].includes(kind) && (
          <circle cx="60" cy="64" r="30" fill="#22c55e" />
        )}
      </svg>
    </div>
  );
}
