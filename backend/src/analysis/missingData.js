// Absence of evidence is a distinct state: never silently treat it as zero or a pass.
export function isPresent(value) {
  return value !== null && value !== undefined && !(typeof value === 'number' && Number.isNaN(value));
}

export function valueOrUnavailable(value, sentinel = 'unavailable') {
  return isPresent(value) ? value : sentinel;
}
