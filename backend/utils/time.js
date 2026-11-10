/**
 * Date, Time, and Meal Timing Utilities (IST Asia/Kolkata)
 */

const MEAL_WINDOWS = {
  breakfast: { startMinutes: 7 * 60 + 30, endMinutes: 9 * 60, label: '7:30 - 9:00' },
  lunch: { startMinutes: 12 * 60, endMinutes: 14 * 60, label: '12:00 - 14:00' },
  snacks: { startMinutes: 16 * 60, endMinutes: 17 * 60, label: '16:00 - 17:00' },
  dinner: { startMinutes: 19 * 60 + 30, endMinutes: 21 * 60, label: '19:30 - 21:00' }
};

const MEAL_START_MINUTES = {
  breakfast: 7 * 60 + 30, // 07:30
  lunch: 12 * 60,         // 12:00
  snacks: 16 * 60,        // 16:00
  dinner: 19 * 60 + 30    // 19:30
};

/**
 * Returns current IST date formatted as YYYY-MM-DD
 */
function getISTDateString(date = new Date()) {
  const d = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date;
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);
}

/**
 * Returns current IST Day of Week (e.g. 'Monday', 'Tuesday')
 */
function getISTDayOfWeek(date = new Date()) {
  const d = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date;
  return new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', weekday: 'long' }).format(d);
}

/**
 * Returns total minutes from midnight for given time in IST
 */
function getISTTimeMinutes(date = new Date()) {
  const d = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    hour12: false,
    hour: 'numeric',
    minute: 'numeric'
  }).formatToParts(d);
  const hour = parseInt(parts.find(p => p.type === 'hour').value, 10);
  const minute = parseInt(parts.find(p => p.type === 'minute').value, 10);
  return hour * 60 + minute;
}

/**
 * Returns whether current IST time is inside the given meal's window
 */
function isWithinMealWindow(mealType, date = new Date()) {
  if (!mealType) return false;
  const window = MEAL_WINDOWS[mealType.toLowerCase()];
  if (!window) return false;
  const currentMinutes = getISTTimeMinutes(date);
  return currentMinutes >= window.startMinutes && currentMinutes <= window.endMinutes;
}

/**
 * Returns current active or upcoming meal based on IST time of day
 */
function getCurrentMeal(date = new Date()) {
  const currentMinutes = getISTTimeMinutes(date);
  if (currentMinutes <= 10 * 60 + 30) return 'breakfast';
  if (currentMinutes <= 15 * 60) return 'lunch';
  if (currentMinutes <= 18 * 60) return 'snacks';
  return 'dinner';
}

/**
 * Returns formatted IST timestamp string (YYYY-MM-DD HH:mm:ss)
 */
function getISTDateTimeString(date = new Date()) {
  const d = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(d).reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});

  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

module.exports = {
  MEAL_WINDOWS,
  MEAL_START_MINUTES,
  getISTDateString,
  getISTDayOfWeek,
  getISTTimeMinutes,
  isWithinMealWindow,
  getCurrentMeal,
  getISTDateTimeString
};
