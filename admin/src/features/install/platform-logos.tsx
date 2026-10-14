import type { ReactNode, SVGProps } from 'react';

/** Platform marks, redrawn from the legacy sprite (i-wordpress … i-share-direct). */
const MARKS: Record<string, ReactNode> = {
  wordpress: (
    <>
      <circle cx="12" cy="12" r="10" fill="#21759B" />
      <path
        fill="#fff"
        d="M5.6 8.6h1.9l2 6.2 1.4-4.2-.6-2h1.9l2 6.2 1.5-4.8c.3-1 .1-1.4-.4-1.4h1.9l-3.1 8.6h-1.4l-1.9-5.6-1.9 5.6H7.6z"
      />
    </>
  ),
  webflow: (
    <path
      fill="#146EF5"
      d="M19.16 7.42h-3.32l-2.02 5.8-2.06-5.8H7.78L4.84 16.58h3.33l1.53-4.7 1.8 4.7h2.8l2.02-5.46 2.02 5.46h3.32L19.16 7.42Z"
    />
  ),
  framer: <path fill="currentColor" d="M5 2h14v7h-7zM5 9h7l7 7H12v7l-7-7z" />,
  wix: (
    <>
      <rect x="1" y="5" width="22" height="14" rx="4" fill="currentColor" />
      <path
        fill="none"
        stroke="var(--background, #fff)"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M5 9.5l1.4 5 1.6-5 1.6 5 1.4-5M13.3 9.5v5M16 9.5l3 5M19 9.5l-3 5"
      />
    </>
  ),
  squarespace: (
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      d="M4.5 12.5l6-6a2.6 2.6 0 0 1 3.7 3.7l-4 4M19.5 11.5l-6 6a2.6 2.6 0 0 1-3.7-3.7l4-4"
    />
  ),
  gtm: (
    <>
      <rect x="5" y="5" width="14" height="14" rx="3" transform="rotate(45 12 12)" fill="#4285F4" />
      <circle cx="12" cy="12" r="2.6" fill="#fff" />
    </>
  ),
  html5: (
    <path
      fill="#E34F26"
      d="m3 2 1.8 17.5L12 22l7.2-2.5L21 2H3zm14.8 4.2-.3 3.6h-7.7l.3 3.2h7.1l-.7 7-5.2 1.5-5.2-1.5-.4-4.5h2.5l.2 2.3 2.9.8 2.9-.8.3-3.6H6.6L5.9 6.2h11.9z"
    />
  ),
  react: (
    <g fill="none" stroke="#00D8FF" strokeWidth="1.5">
      <ellipse cx="12" cy="12" rx="10" ry="3.8" />
      <ellipse cx="12" cy="12" rx="10" ry="3.8" transform="rotate(60 12 12)" />
      <ellipse cx="12" cy="12" rx="10" ry="3.8" transform="rotate(120 12 12)" />
      <circle cx="12" cy="12" r="2" fill="#00D8FF" stroke="none" />
    </g>
  ),
  'share-direct': (
    <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </g>
  ),
};

export function PlatformLogo({ mark, ...props }: { mark: string } & SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" {...props}>
      {MARKS[mark]}
    </svg>
  );
}
