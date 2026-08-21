/**
 * Icon set — minimal, consistent 24×24 stroke icons (1.5px, currentColor).
 * Presentational only: no props beyond `size` and standard SVG attributes.
 */
import type { ReactNode, SVGProps } from 'react';

export interface IconProps extends SVGProps<SVGSVGElement> {
  /** Rendered width/height in px (default 20). */
  size?: number;
}

function createIcon(displayName: string, content: ReactNode) {
  function Icon({ size = 20, ...rest }: IconProps) {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
        {...rest}
      >
        {content}
      </svg>
    );
  }

  Icon.displayName = displayName;
  return Icon;
}

export const HomeIcon = createIcon(
  'HomeIcon',
  <>
    <path d="m3.5 9.7 8.2-6.4a1 1 0 0 1 1.1 0l8.2 6.4V20a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4.5 20Z" />
    <path d="M9.5 21.5v-6a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v6" />
  </>,
);

export const SparklesIcon = createIcon(
  'SparklesIcon',
  <>
    <path d="M12 4.5 10.4 9.1a1.5 1.5 0 0 1-.9.9L4.8 11.6l3.7 1.6a1.5 1.5 0 0 1 .9.9l1.6 3.7 1.6-3.7a1.5 1.5 0 0 1 .9-.9l3.7-1.6-3.7-1.6a1.5 1.5 0 0 1-.9-.9Z" />
    <path d="M19 3v3.5 M20.75 4.75h-3.5" />
    <path d="M5 16.5V20 M6.75 18.25h-3.5" />
  </>,
);

export const SparkleIcon = createIcon(
  'SparkleIcon',
  <path d="M12 4.5 10.4 9.1a1.5 1.5 0 0 1-.9.9L5.8 11.6l3.7 1.6a1.5 1.5 0 0 1 .9.9l1.6 3.7 1.6-3.7a1.5 1.5 0 0 1 .9-.9l3.7-1.6-3.7-1.6a1.5 1.5 0 0 1-.9-.9Z" />,
);

export const FolderIcon = createIcon(
  'FolderIcon',
  <path d="M4 6a2 2 0 0 1 2-2h3.2a2 2 0 0 1 1.5.7L11.8 6H18a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z" />,
);

export const LayersIcon = createIcon(
  'LayersIcon',
  <>
    <path d="m12 3.5 8.5 4L12 11.5l-8.5-4Z" />
    <path d="m4 12.5 8 3.75a1.6 1.6 0 0 0 1 0l8-3.75" />
    <path d="m4 16.5 8 3.75a1.6 1.6 0 0 0 1 0l8-3.75" />
  </>,
);

export const SlidersIcon = createIcon(
  'SlidersIcon',
  <>
    <path d="M4 5h9 M18.5 5H20 M4 12h3 M12.5 12H20 M4 19h9 M18.5 19H20" />
    <circle cx="15.25" cy="5" r="2" />
    <circle cx="9.75" cy="12" r="2" />
    <circle cx="15.25" cy="19" r="2" />
  </>,
);

export const SettingsIcon = createIcon(
  'SettingsIcon',
  <>
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z" />
    <circle cx="12" cy="12" r="3" />
  </>,
);

export const PaperclipIcon = createIcon(
  'PaperclipIcon',
  <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />,
);

export const ArrowUpIcon = createIcon(
  'ArrowUpIcon',
  <>
    <path d="M12 19V5" />
    <path d="m5 12 7-7 7 7" />
  </>,
);

export const ImageIcon = createIcon(
  'ImageIcon',
  <>
    <rect x="3.5" y="3.5" width="17" height="17" rx="2.5" />
    <circle cx="9" cy="9" r="1.75" />
    <path d="m20.5 14.5-4-4a1.8 1.8 0 0 0-2.6 0L7.5 16.9" />
  </>,
);

export const UserIcon = createIcon(
  'UserIcon',
  <>
    <circle cx="12" cy="8" r="3.75" />
    <path d="M5 20.25a7 7 0 0 1 14 0" />
  </>,
);
