/** Shared liquid-glass pill classes (see app/globals.css — matches Borean Astro lg-nav-pill / btn-chip). */

const base =
  'glass-pill relative inline-flex items-center justify-center leading-normal transition-colors disabled:cursor-not-allowed'

export const glassPillXs = `${base} px-3 py-1 text-xs font-medium text-white`
export const glassPillSm = `${base} px-3 py-1.5 text-xs font-medium text-white`
export const glassPillMd = `${base} px-4 py-2 text-sm font-medium text-white`
export const glassPillLg = `${base} px-5 py-2.5 text-sm font-semibold text-white`
export const glassPillLgWide = `${base} px-6 py-2.5 text-sm font-semibold text-white shadow-sm`
export const glassPillXl = `${base} px-5 py-2.5 text-lg font-semibold text-white`

export const glassPillToggleActive = `${base} glass-pill-active px-3 py-2 text-sm font-medium text-white`
export const glassPillToggleIdle = `${base} glass-pill-idle px-3 py-2 text-sm font-medium`
export const glassPillToggleActiveBlock = `${base} glass-pill-active w-full px-4 py-2 text-left text-sm font-medium text-white`
export const glassPillToggleIdleBlock = `${base} glass-pill-idle w-full px-4 py-2 text-left text-sm font-medium`

export const glassPillToggleActiveMd = `${base} glass-pill-active px-4 py-2 text-sm font-medium text-white`
export const glassPillToggleIdleMd = `${base} glass-pill-idle px-4 py-2 text-sm font-medium`
export const glassPillToggleDisabledMd = `${base} glass-pill-disabled w-full px-3 py-2 text-sm font-medium`

export const glassPillToggleActiveInverted = `${base} glass-pill-active-inverted px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-60`
export const glassPillToggleIdleSm = `${base} glass-pill-idle px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-60`

export const glassPillSecondary = `${base} border-transparent bg-transparent px-6 py-2.5 text-sm font-semibold text-white hover:bg-white/10`

export const glassPillDangerSm = `${base} glass-pill-danger px-3 py-1 text-xs`
export const glassPillDangerMd = `${base} glass-pill-danger px-4 py-2 text-sm font-medium`
export const glassPillDangerSolid = `${base} glass-pill-danger-solid px-4 py-2 text-sm font-medium text-white`
export const glassPillDangerLg = `${base} glass-pill-danger-solid px-5 py-2.5 text-lg font-semibold text-white`
export const glassPillDangerWide = `${base} glass-pill-danger-solid w-full max-w-md px-5 py-2.5 text-2xl font-semibold text-white`

export const glassPillSuccessSm = `${base} glass-pill-success px-3 py-1 text-xs`
export const glassPillWarningSm = `${base} glass-pill-warning px-2 py-1 text-xs`
export const glassPillInfoSm = `${base} glass-pill-info px-2 py-1 text-xs`
export const glassPillSkySm = `${base} glass-pill-sky px-2 py-1 text-xs`
export const glassPillAccentSm = `${base} glass-pill-accent px-2 py-1 text-xs`

export const glassPillMuted = `${base} glass-pill-muted px-4 py-2 text-sm text-gray-300`
export const glassPillDisabled = `${base} glass-pill-disabled px-3 py-1.5 text-xs font-medium`
export const glassPillIcon = `${base} glass-pill-icon p-2.5`

export const glassPillFullWidthSm = `${base} w-full px-3 py-2 text-sm font-medium text-white`
export const glassPillFullWidthMd = `${base} w-full px-3 py-2 text-center text-sm font-medium text-white`

/** Ghost glass pill — text at rest, liquid glass pill on hover */
const ghostLink =
  `${base} glass-pill-ghost inline-flex items-center justify-center font-medium disabled:cursor-not-allowed disabled:opacity-40`

/** Dashboard header nav */
export const glassNavLink = `${ghostLink} px-4 py-2 text-sm`
export const glassNavLinkActive = `${ghostLink} glass-pill-ghost-active px-4 py-2 text-sm`
export const glassNavLinkMobile = `${ghostLink} flex w-full px-3 py-2.5 text-sm`

/** Plan sky layer toggles — same ghost hover, smaller */
export const planLayerLink = `${ghostLink} px-2.5 py-1 text-xs`
export const planLayerLinkActive = `${ghostLink} glass-pill-ghost-active px-2.5 py-1 text-xs`
