import type { CSSProperties } from 'react';

interface Props {
  size?: number;
  className?: string;
  style?: CSSProperties;
}

export default function BrandMark({ size = 44, className, style }: Props) {
  return (
    <span
      className={className}
      style={{
        width: size,
        height: size,
        display: 'inline-grid',
        placeItems: 'center',
        flexShrink: 0,
        ...style,
      }}
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 48 48"
        width={size}
        height={size}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <linearGradient id="dp-mark-gradient" x1="8" y1="8" x2="40" y2="40" gradientUnits="userSpaceOnUse">
            <stop stopColor="#A78BFA" />
            <stop offset="1" stopColor="#22D3EE" />
          </linearGradient>
        </defs>
        <rect x="2.5" y="2.5" width="43" height="43" rx="13" fill="#0C111A" stroke="rgba(167,139,250,.35)" />
        <path d="M13 29.5L23 19L30 25L36 17.5" stroke="url(#dp-mark-gradient)" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="13" cy="29.5" r="3.4" fill="#A78BFA" />
        <circle cx="23" cy="19" r="3.4" fill="#B9A7FF" />
        <circle cx="30" cy="25" r="3.4" fill="#67E8F9" />
        <circle cx="36" cy="17.5" r="3.4" fill="#22D3EE" />
        <path d="M12 36H36" stroke="rgba(255,255,255,.14)" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </span>
  );
}
