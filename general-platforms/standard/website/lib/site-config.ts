export type ProductPlan = 'standard' | 'pro' | 'max' | 'ultra'

export type PlanAvailability = 'available' | 'coming-soon'

export const PRODUCT_PLANS: ProductPlan[] = ['standard', 'pro', 'max', 'ultra']

export const SITE_URL = 'https://www.boreanastro.com'

export const FRAOS = {
  name: 'FRAOS',
  fullName: 'Fully Remote Automated Observatory System',
  summary:
    'Cloud-connected observatory software — remote control, automated scheduling, and NINA integration for serious astrophotography.',
  tierTagline: 'Standard · Pro · Max · Ultra — one rig to a full observatory network.',
} as const

export const ASC = {
  name: 'ASC',
  fullName: 'All Sky Camera',
  summary: 'Networked all-sky imaging for weather-aware observatory operations. Product pages coming soon.',
} as const

export const PLANS: Record<
  ProductPlan,
  {
    name: string
    shortName: string
    tagline: string
    headline: string
    price: string
    period: string
    availability: PlanAvailability
    sites: string
    seats: string
    features: string[]
    highlights: Array<{ title: string; body: string }>
  }
> = {
  standard: {
    name: 'FRAOS Standard',
    shortName: 'Standard',
    tagline: 'One telescope · one operator.',
    headline: 'Your backyard observatory, always within reach.',
    price: '$499',
    period: 'one-time license',
    availability: 'available',
    sites: '1 site',
    seats: '1 seat',
    features: [
      'Borean Control Client (Windows / macOS)',
      'Borean Station + NINA agent (Windows)',
      'Dedicated cloud hub on www.boreanastro.com',
      'Remote scheduling & session queue',
      'Optional raw ZIP upload to your R2 bucket',
      'In-app OTA updates for Control Client and Station',
    ],
    highlights: [
      {
        title: 'Control from anywhere',
        body: 'Plan targets, check weather, queue sessions, and monitor status from Control Client — whether you are at home or traveling.',
      },
      {
        title: 'Station on the observatory PC',
        body: 'Borean Station runs the NINA agent, system diagnostics, and one-click setup for Python, autostart, and updates on Windows.',
      },
      {
        title: 'Your own cloud hub',
        body: 'Every license embeds a tenant on Borean Astro cloud. Your installer connects only to your hub — not a shared account.',
      },
    ],
  },
  pro: {
    name: 'FRAOS Pro',
    shortName: 'Pro',
    tagline: 'One telescope · your team.',
    headline: 'Share one observatory safely across operators.',
    price: 'From $799',
    period: 'per year',
    availability: 'coming-soon',
    sites: '1 site',
    seats: 'Up to 10 seats',
    features: [
      'Everything in FRAOS Standard',
      'Multi-seat access with role-based permissions',
      'Operator vs admin roles for night sessions',
      'Shared session queue with accountability',
      'Team cloud hub on www.boreanastro.com',
      'Included R2 storage quota with fair-use policy',
    ],
    highlights: [
      {
        title: 'Built for clubs and schools',
        body: 'Give members remote access to one club observatory without sharing passwords or mixing personal data.',
      },
      {
        title: 'Roles that match real operations',
        body: 'Admins configure the system; operators queue targets and monitor sessions — clear separation for safe handoffs.',
      },
      {
        title: 'One rig, many people',
        body: 'Cloud costs stay predictable because you scale seats, not telescopes — ideal for a single shared pier.',
      },
    ],
  },
  max: {
    name: 'FRAOS Max',
    shortName: 'Max',
    tagline: 'Multiple telescopes · one operator.',
    headline: 'Run every site from a single account.',
    price: 'From $1,299',
    period: 'per year',
    availability: 'coming-soon',
    sites: 'Up to 5 sites',
    seats: '1 seat',
    features: [
      'Everything in FRAOS Standard',
      'Multi-site dashboard under one owner account',
      'Dedicated cloud hub per observatory site',
      'Per-site R2 storage quotas',
      'Cross-site visibility in Control Client',
      'Priority email support',
    ],
    highlights: [
      {
        title: 'Home plus remote dark sites',
        body: 'Manage backyard and remote observatories from one login — each site keeps its own tenant and credentials.',
      },
      {
        title: 'Scale sites, not seats',
        body: 'Designed for advanced imagers who operate multiple rigs solo. Pay for observatories, not operator headcount.',
      },
      {
        title: 'Cloud that grows with you',
        body: 'Each additional site provisions its own hub and storage — costs track real infrastructure use.',
      },
    ],
  },
  ultra: {
    name: 'FRAOS Ultra',
    shortName: 'Ultra',
    tagline: 'Multiple telescopes · your organization.',
    headline: 'Operate observatory networks at scale.',
    price: 'Custom',
    period: 'annual contract',
    availability: 'coming-soon',
    sites: 'Unlimited sites',
    seats: 'Unlimited seats',
    features: [
      'Everything in FRAOS Pro and Max',
      'Organization dashboard across all sites',
      'Enterprise role-based access & audit',
      'Priority support & SLA',
      'Custom branding & white-label options',
      'Dedicated onboarding & migration',
    ],
    highlights: [
      {
        title: 'Multi-site, multi-team',
        body: 'Run several observatories with distinct operator groups — unified visibility without mixing customer data.',
      },
      {
        title: 'Enterprise operations',
        body: 'Separate admin and operator access so teams can run night sessions safely with clear accountability.',
      },
      {
        title: 'Built for institutions',
        body: 'Priority onboarding, SLA-backed support, and optional white-label branding for clubs, schools, and commercial sites.',
      },
    ],
  },
}

export function planLabel(plan: ProductPlan): string {
  return PLANS[plan].shortName
}

export function planIsPurchasable(plan: ProductPlan): boolean {
  return PLANS[plan].availability === 'available'
}
