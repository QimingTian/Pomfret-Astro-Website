const ADMIN_PASSWORD = '1894'

export function isImagingAdminPassword(password: string | null | undefined): boolean {
  return typeof password === 'string' && password.trim() !== '' && password.trim() === ADMIN_PASSWORD
}

