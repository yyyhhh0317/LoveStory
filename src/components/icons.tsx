interface IconProps {
  size?: number
  className?: string
}

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
})

export function PlusIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

export function CloseIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  )
}

export function BookIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <path d="M4 5.5A1.5 1.5 0 015.5 4H10v16H5.5A1.5 1.5 0 014 18.5v-13z" />
      <path d="M10 4h8.5A1.5 1.5 0 0120 5.5v13a1.5 1.5 0 01-1.5 1.5H10" />
    </svg>
  )
}

export function ArrowLeftIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <path d="M14.5 5.5L8 12l6.5 6.5" />
    </svg>
  )
}

export function ArrowRightIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <path d="M9.5 5.5L16 12l-6.5 6.5" />
    </svg>
  )
}

export function MessageIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <path d="M20 12.5a7.5 7.5 0 01-7.5 7.5H8l-4 2.5.9-3.6A7.5 7.5 0 1120 12.5z" />
    </svg>
  )
}

export function StarIcon({ size = 18, className, filled }: IconProps & { filled?: boolean }) {
  return (
    <svg
      {...base(size)}
      className={className}
      fill={filled ? 'currentColor' : 'none'}
      aria-hidden="true"
    >
      <path d="M12 3.6l2.6 5.4 5.9.8-4.3 4.1 1.1 5.9L12 17l-5.3 2.8 1.1-5.9L3.5 9.8l5.9-.8z" />
    </svg>
  )
}

export function HeartIcon({ size = 16, className, filled }: IconProps & { filled?: boolean }) {
  return (
    <svg
      {...base(size)}
      className={className}
      fill={filled ? 'currentColor' : 'none'}
      aria-hidden="true"
    >
      <path d="M20.5 4.5a5.4 5.4 0 00-7.6 0L12 5.4l-.9-.9a5.4 5.4 0 10-7.6 7.6l.9.9L12 20.6l7.6-7.6.9-.9a5.4 5.4 0 000-7.6z" />
    </svg>
  )
}

export function TrashIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <path d="M4 7h16M9 7V5h6v2M6.5 7l.8 12h9.4l.8-12" />
    </svg>
  )
}

export function PhotoIcon({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <circle cx="8.6" cy="9.6" r="1.4" />
      <path d="M4.4 16.6l4.3-4 3.3 3 2.6-2.3 4.9 4.4" />
    </svg>
  )
}

export function ListIcon({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <path d="M4 7.2l1.9 1.9L9 5.9" />
      <path d="M4 15.2l1.9 1.9L9 13.9" />
      <path d="M12.5 7.5H20M12.5 15.5H20" />
    </svg>
  )
}
