interface IdleIconProps {
  /** Idle → amber + animated; otherwise gray + static. */
  idle: boolean;
  /** Pixel size (square). Default 16. */
  size?: number;
  className?: string;
}

/**
 * Laptop + two rising "z" glyphs. Single-colour via inline `color` so the
 * container's text colour is irrelevant; gray when active, amber when idle.
 * Animation is driven by the `data-idle` attribute + classes in index.css.
 */
export function IdleIcon({ idle, size = 16, className = "" }: IdleIconProps) {
  return (
    <svg
      data-testid="idle-icon"
      className={`idle-icon ${className}`}
      data-idle={idle ? "true" : "false"}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ color: idle ? "#fbbf24" : "rgba(255,255,255,0.55)" }}
    >
      {/* laptop screen + base */}
      <g className="idle-laptop">
        <rect x="4" y="7" width="13" height="9" rx="1" />
        <path d="M2 18 h17" />
      </g>
      {/* two z's, small then large */}
      <path className="idle-z idle-z-1" d="M16 4 h3 l-3 3 h3" />
      <path className="idle-z idle-z-2" d="M19.5 2 h2.2 l-2.2 2.2 h2.2" />
    </svg>
  );
}
