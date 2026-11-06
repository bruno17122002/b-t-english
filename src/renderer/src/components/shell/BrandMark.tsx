// B&T English logo mark: same artwork as build/logo.svg (the app icon), drawn inline so it stays sharp at any size.
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 256 256" className={className} aria-hidden="true" focusable="false">
      <rect x="8" y="8" width="240" height="240" rx="56" fill="#005FB8" />
      <g fill="none" stroke="#FFFFFF" strokeWidth="22" strokeLinecap="round" strokeLinejoin="round">
        <path d="M54 56 H206" />
        <path d="M54 56 V168" />
        <path d="M84 56 A26 26 0 0 1 84 108 H54" />
        <path d="M54 108 H90 A30 30 0 0 1 90 168 H54" />
        <path d="M172 56 V170" />
      </g>
      <path d="M50 204 C100 218 160 216 206 188" fill="none" stroke="#60CDFF" strokeWidth="14" strokeLinecap="round" />
    </svg>
  )
}
