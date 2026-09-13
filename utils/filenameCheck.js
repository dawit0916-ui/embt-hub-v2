function parseScreenshotFilename(filename) {
  const match = filename.match(/Screenshot_(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})_([A-Za-z0-9]+)/);
  if (!match) {
    return { present: false, timestamp: null, appName: null };
  }

  const [, year, month, day, hour, minute, second, appName] = match;
  const timestamp = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}`);

  return { present: true, timestamp, appName };
}

module.exports = { parseScreenshotFilename };
