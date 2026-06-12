/// <reference path="../vite-env.d.ts" />
import type { PersonalTenantConfig } from '@shared/tenant-config'
import tenantConfig from '@tenant-config'

export function getPersonalTenant(): PersonalTenantConfig {
  return tenantConfig as PersonalTenantConfig
}

export function getTenantLabel(): string {
  const t = getPersonalTenant()
  return t.displayName?.trim() || t.tenantId
}
