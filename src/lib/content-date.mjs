/**
 * Frontmatter calendar dates are parsed at UTC midnight. Use the same calendar
 * for visible labels, archive buckets and feed metadata on every build machine.
 * Timestamp inputs are normalized to their UTC calendar date as well.
 * @param {Date} date
 */
export function contentDateParts(date) {
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

/** @param {Date} date */
export function formatDate(date) {
  const { year, month, day } = contentDateParts(date);
  return `${year}.${String(month).padStart(2, '0')}.${String(day).padStart(2, '0')}`;
}

/** @param {Date} date */
export function shortDate(date) {
  return formatDate(date).slice(5);
}
