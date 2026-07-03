/** Logo wavy da VLMA. Usa currentColor no traço; o ponto é laranja de marca. */
export function VlmaLogo({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 260 48" className={className} fill="none" aria-label="VLMA" role="img">
      <path
        d="M6 30 L26 30 L40 14 L54 38 L78 30 L78 18 L108 18 L122 38 L150 14 L178 38 L200 16 L222 38 L240 22"
        stroke="currentColor"
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="170" cy="16" r="6" fill="#FF9900" />
    </svg>
  )
}

export default VlmaLogo
