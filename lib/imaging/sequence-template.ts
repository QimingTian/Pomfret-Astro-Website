export type ImagingSequenceTemplate = 'dso' | 'variable_star' | 'asteroid_occultation'

export function imagingSequenceTemplate(value: unknown): ImagingSequenceTemplate {
  if (value === 'variable_star' || value === 'asteroid_occultation') return value
  return 'dso'
}
