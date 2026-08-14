/** Set de iconos SVG propio (trazo 1.8, estilo lucide) — sustituye los emojis genéricos */

interface IconProps {
  size?: number
  className?: string
}

function Svg({
  size = 15,
  className,
  children
}: IconProps & { children: React.ReactNode }): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

export const IconPlus = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
)

export const IconSearch = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="m21 21-4.35-4.35" />
  </Svg>
)

export const IconHistory = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
    <path d="M3 3v5h5" />
    <path d="M12 7v5l3 3" />
  </Svg>
)

export const IconCommand = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="m4 17 6-5-6-5" />
    <path d="M12 19h8" />
  </Svg>
)

export const IconSliders = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M21 6H10M6 6H3M21 12h-9M8 12H3M21 18h-5M12 18H3" />
    <circle cx="8" cy="6" r="2" />
    <circle cx="14" cy="12" r="2" />
    <circle cx="18" cy="18" r="2" />
  </Svg>
)

export const IconSun = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4m11.4-11.4 1.4-1.4" />
  </Svg>
)

export const IconMoon = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
  </Svg>
)

export const IconSend = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M22 2 11 13" />
    <path d="M22 2 15 22l-4-9-9-4Z" />
  </Svg>
)

export const IconStop = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor" stroke="none" />
  </Svg>
)

export const IconPaperclip = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="m21.4 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
  </Svg>
)

export const IconX = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M18 6 6 18M6 6l12 12" />
  </Svg>
)

export const IconPlay = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M10 8.5 16 12l-6 3.5V8.5Z" />
  </Svg>
)

export const IconPr = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <circle cx="6" cy="6" r="2.5" />
    <circle cx="6" cy="18" r="2.5" />
    <circle cx="18" cy="18" r="2.5" />
    <path d="M6 8.5v7M18 15.5V10a3 3 0 0 0-3-3h-3" />
    <path d="M14 4.5 12 7l2 2.5" />
  </Svg>
)

export const IconStore = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M4 7h16l-1 4a3 3 0 0 1-3 2.5A3 3 0 0 1 13 11a3 3 0 0 1-3 2.5A3 3 0 0 1 7 11L4 7Z" />
    <path d="M4 7l1.5-3.5h13L20 7" />
    <path d="M6 13v7h12v-7" />
    <path d="M10 20v-4h4v4" />
  </Svg>
)

export const IconTune = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M4 6h10M18 6h2M4 12h2M10 12h10M4 18h10M18 18h2" />
    <circle cx="16" cy="6" r="2" />
    <circle cx="8" cy="12" r="2" />
    <circle cx="16" cy="18" r="2" />
  </Svg>
)

export const IconPulse = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
  </Svg>
)

export const IconRefresh = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M21 12a9 9 0 1 1-2.64-6.36" />
    <path d="M21 3v6h-6" />
  </Svg>
)

export const IconFolder = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2Z" />
  </Svg>
)

export const IconBot = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <rect x="5" y="8" width="14" height="11" rx="2" />
    <path d="M12 8V4m-2 0h4" />
    <circle cx="9.5" cy="13" r="0.8" fill="currentColor" />
    <circle cx="14.5" cy="13" r="0.8" fill="currentColor" />
    <path d="M9 16.5h6" />
  </Svg>
)

export const IconBook = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M2 4h6a4 4 0 0 1 4 4v12a3 3 0 0 0-3-3H2Z" />
    <path d="M22 4h-6a4 4 0 0 0-4 4v12a3 3 0 0 1 3-3h7Z" />
  </Svg>
)

export const IconHook = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <circle cx="12" cy="5" r="2.5" />
    <path d="M12 7.5V16a5 5 0 0 0 10 0" />
    <path d="M12 21a5 5 0 0 1-5-5" />
  </Svg>
)

export const IconPlug = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M12 22v-4M9 7V2M15 7V2" />
    <path d="M6 7h12v5a6 6 0 0 1-12 0Z" />
  </Svg>
)

export const IconFileText = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
    <path d="M14 2v6h6M9 13h6M9 17h6" />
  </Svg>
)

export const IconEye = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
    <circle cx="12" cy="12" r="3" />
  </Svg>
)

export const IconTasks = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="m3 6 2 2 3.5-3.5M3 13l2 2 3.5-3.5M3 20l2 2 3.5-3.5" transform="translate(0 -1.5)" />
    <path d="M12 6h9M12 12h9M12 18h9" />
  </Svg>
)

export const IconChat = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M21 12a8 8 0 0 1-8 8H4l2.5-2.5A8 8 0 1 1 21 12Z" />
  </Svg>
)

export const IconGitBranch = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <circle cx="6" cy="5" r="2.5" />
    <circle cx="6" cy="19" r="2.5" />
    <circle cx="18" cy="8" r="2.5" />
    <path d="M6 7.5v9M18 10.5a7 7 0 0 1-7 6.5h-2.5" />
  </Svg>
)

export const IconBoard = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M9 3v18M15 3v12" />
  </Svg>
)

export const IconTerminal = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <rect x="2" y="4" width="20" height="16" rx="2" />
    <path d="m6 9 3 3-3 3M12 15h6" />
  </Svg>
)
