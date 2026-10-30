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

/** The most recent editorial activity across posts and notes.
 * @param {Iterable<{ date: Date, updated?: Date }>} entries
 * @returns {Date | undefined}
 */
export function latestActivity(entries) {
  let latest;
  for (const data of entries) {
    const date = activityDate(data);
    if (!latest || date.getTime() > latest.getTime()) latest = date;
  }
  return latest;
}
