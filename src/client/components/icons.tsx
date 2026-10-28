import type { ReactNode, SVGProps } from "react";

/**
 * Inline SVG icon set. Every icon inherits its size (1em) and colour
 * (currentColor) from the surrounding text, so each one drops into the exact
 * spot its old unicode glyph occupied. All paths are drawn locally — no icon
 * font, no CDN, nothing fetched at runtime.
 */

type IconProps = SVGProps<SVGSVGElement> & {
  size?: number | string;
  children?: ReactNode;
};

export function IconSound({ muted = false, ...props }: IconProps & { muted?: boolean }) {
  return <Base {...props}><path d="M11 5 6 9H3v6h3l5 4Z" />{muted ? <path d="m16 9 5 6m0-6-5 6" /> : <><path d="M15 8a6 6 0 0 1 0 8" /><path d="M18 5a10 10 0 0 1 0 14" /></>}</Base>;
}

function Base({ size = "1em", className, children, ...rest }: IconProps) {
  return (
    <svg
      className={className ? `icon ${className}` : "icon"}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export function IconChevronLeft(props: IconProps) {
  return (
    <Base {...props}>
      <polyline points="15 18 9 12 15 6" />
    </Base>
  );
}

export function IconChevronRight(props: IconProps) {
  return (
    <Base {...props}>
      <polyline points="9 18 15 12 9 6" />
    </Base>
  );
}

export function IconChevronDown(props: IconProps) {
  return (
    <Base {...props}>
      <polyline points="6 9 12 15 18 9" />
    </Base>
  );
}

export function IconClose(props: IconProps) {
  return (
    <Base {...props}>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </Base>
  );
}

export function IconCheck(props: IconProps) {
  return (
    <Base {...props}>
      <polyline points="20 6 9 17 4 12" />
    </Base>
  );
}

export function IconExternal(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </Base>
  );
}

export function IconRotate(props: IconProps) {
  return (
    <Base {...props}>
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </Base>
  );
}

export function IconExpand(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
    </Base>
  );
}

export function IconCompress(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" />
    </Base>
  );
}

function Solid({
  size = "1em",
  className,
  points,
  ...rest
}: IconProps & { points: string }) {
  return (
    <svg
      className={className ? `icon ${className}` : "icon"}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <polygon points={points} />
    </svg>
  );
}

/** Play-triangle used for the lobby tiles. */
export function IconPlay(props: IconProps) {
  return <Solid points="7 4 20 12 7 20" {...props} />;
}

export function IconPause(props: IconProps) {
  return <Base {...props}><line x1="8" y1="5" x2="8" y2="19" /><line x1="16" y1="5" x2="16" y2="19" /></Base>;
}

/** Five-point rarity star. Colour comes from the surrounding text. */
export function IconStar(props: IconProps) {
  return (
    <Solid
      points="12 2.6 14.9 8.7 21.7 9.5 16.7 14.2 18.1 21 12 17.6 5.9 21 7.3 14.2 2.3 9.5 9.1 8.7"
      {...props}
    />
  );
}

/** A row of N rarity stars. */
export function Stars({ n, className }: { n: number; className?: string }) {
  return (
    <span className={className ? `stars ${className}` : "stars"} aria-hidden="true">
      {Array.from({ length: Math.max(0, n) }, (_, i) => (
        <IconStar key={i} />
      ))}
    </span>
  );
}

/**
 * The lobby's decorative △ × + ○ strip as real shapes rather than a text
 * run. Pure decoration (the parent is aria-hidden).
 */
export function DecoShapes() {
  return (
    <span className="deco-shapes" aria-hidden="true">
      <Base size="0.9em">
        <polygon points="12 5 20 19 4 19" />
      </Base>
      <Base size="0.9em">
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
      </Base>
      <Base size="0.9em">
        <line x1="12" y1="5" x2="12" y2="19" />
        <line x1="5" y1="12" x2="19" y2="12" />
      </Base>
      <Base size="0.9em">
        <circle cx="12" cy="12" r="8" />
      </Base>
    </span>
  );
}
