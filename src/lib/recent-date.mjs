/** Choose publication or a later editorial update for recently active content.
 * Keep the original publication date for normal search and archive metadata.
 * @param {{ date: Date, updated?: Date }} data
 * @returns {Date}
 */
export function activityDate(data) {
  const revised = data.updated;
  return revised instanceof Date && Number.isFinite(revised.getTime())
    && revised.getTime() > data.date.getTime() ? revised : data.date;
}
