import type { BillingCycle } from '@/lib/checkout-pricing'
import { checkoutPricingForPlan } from '@/lib/checkout-pricing'
import type { ProductPlan } from '@/lib/site-config'
import { PLANS } from '@/lib/site-config'
import type Stripe from 'stripe'

function envPriceId(plan: ProductPlan, cycle: BillingCycle): string | null {
  const key = `STRIPE_PRICE_${plan.toUpperCase()}_${cycle.toUpperCase()}`
  const value = process.env[key]?.trim()
  return value || null
}

function productName(plan: ProductPlan, cycle: BillingCycle): string {
  const tier = PLANS[plan].name
  if (cycle === 'monthly') return `${tier} — Monthly`
  if (cycle === 'annual') return `${tier} — Annual`
  return `${tier} — Lifetime`
}

export function stripeCheckoutMode(cycle: BillingCycle): 'subscription' | 'payment' {
  return cycle === 'lifetime' ? 'payment' : 'subscription'
}

export function buildStripeLineItem(plan: ProductPlan, cycle: BillingCycle): Stripe.Checkout.SessionCreateParams.LineItem {
  const priceId = envPriceId(plan, cycle)
  if (priceId) {
    return { price: priceId, quantity: 1 }
  }

  const option = checkoutPricingForPlan(plan).find((o) => o.cycle === cycle)
  if (!option) {
    throw new Error(`No pricing configured for ${plan} / ${cycle}.`)
  }

  const unitAmount = Math.round(option.amountUsd * 100)
  if (cycle === 'lifetime') {
    return {
      quantity: 1,
      price_data: {
        currency: 'usd',
        unit_amount: unitAmount,
        product_data: {
          name: productName(plan, cycle),
          description: PLANS[plan].tagline,
        },
      },
    }
  }

  return {
    quantity: 1,
    price_data: {
      currency: 'usd',
      unit_amount: unitAmount,
      recurring: {
        interval: cycle === 'monthly' ? 'month' : 'year',
      },
      product_data: {
        name: productName(plan, cycle),
        description: PLANS[plan].tagline,
      },
    },
  }
}
