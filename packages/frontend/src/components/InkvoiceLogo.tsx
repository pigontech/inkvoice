import { cn } from "@/lib/utils";

interface LogoProps {
  className?: string;
}

/** Icon-only mark (the "iv" calligraphic monogram) */
export function InkvoiceIcon({ className }: LogoProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 48 56"
      className={cn("shrink-0", className)}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="iv-s" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="var(--foreground)" />
          <stop offset="100%" stopColor="var(--muted-foreground)" />
        </linearGradient>
        <linearGradient id="iv-a" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#f97316" />
          <stop offset="100%" stopColor="#ef4444" />
        </linearGradient>
      </defs>
      <path
        d="M12 14 C12 14, 16 18, 14 28 C12 38, 8 46, 10 50"
        stroke="url(#iv-s)"
        strokeWidth="5"
        strokeLinecap="round"
        fill="none"
      />
      <circle cx="14" cy="7" r="4.5" fill="url(#iv-a)" />
      <circle cx="20" cy="5" r="1.8" fill="#f97316" opacity="0.4" />
      <circle cx="10" cy="3.5" r="1.3" fill="#ef4444" opacity="0.3" />
      <path
        d="M22 14 C22 14, 28 34, 32 44 C36 34, 42 14, 42 14"
        stroke="url(#iv-s)"
        strokeWidth="4.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <path
        d="M10 50 C14 52, 18 50, 20 46"
        stroke="url(#iv-a)"
        strokeWidth="1.8"
        strokeLinecap="round"
        fill="none"
        opacity="0.5"
      />
    </svg>
  );
}

/** Full logo with icon + wordmark */
export function InkvoiceLogo({ className }: LogoProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 180 68"
      className={cn("shrink-0", className)}
      aria-label="Inkvoice"
    >
      <defs>
        <linearGradient id="ivf-s" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="var(--foreground)" />
          <stop offset="100%" stopColor="var(--muted-foreground)" />
        </linearGradient>
        <linearGradient id="ivf-a" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#f97316" />
          <stop offset="100%" stopColor="#ef4444" />
        </linearGradient>
      </defs>
      <g transform="translate(6, 6)">
        <path
          d="M14 16 C14 16, 18 20, 16 32 C14 44, 10 56, 12 60"
          stroke="url(#ivf-s)"
          strokeWidth="6"
          strokeLinecap="round"
          fill="none"
        />
        <circle cx="16" cy="8" r="5" fill="url(#ivf-a)" />
        <circle cx="22" cy="6" r="2" fill="#f97316" opacity="0.4" />
        <circle cx="12" cy="4" r="1.5" fill="#ef4444" opacity="0.3" />
        <path
          d="M24 16 C24 16, 30 40, 34 52 C38 40, 44 16, 44 16"
          stroke="url(#ivf-s)"
          strokeWidth="5"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
        <path
          d="M12 60 C16 62, 20 60, 22 56"
          stroke="url(#ivf-a)"
          strokeWidth="2"
          strokeLinecap="round"
          fill="none"
          opacity="0.5"
        />
      </g>
      <text
        x="62"
        y="50"
        fontFamily="system-ui, -apple-system, sans-serif"
        fontSize="34"
        letterSpacing="-1.5"
        fill="url(#ivf-s)"
      >
        <tspan fontWeight="900">ink</tspan>
        <tspan fontWeight="400" fill="var(--muted-foreground)">
          voice
        </tspan>
      </text>
      <path
        d="M62 56 C80 58, 120 54, 160 56"
        stroke="url(#ivf-a)"
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}
