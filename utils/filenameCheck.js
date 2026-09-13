// utils/filenameCheck.js

// Common Android photo editors/gallery apps that re-save files, often
// keeping a similar filename pattern after cropping/editing an original screenshot
const KNOWN_EDITOR_APPS = [
  'gallery', 'photos', 'snapseed', 'inshot', 'picsart',
  'lightroom', 'photoeditor', 'crop', 'editor', 'pixlr', 'canva'
];

function parseScreenshotFilename(filename) {
  const match = filename.match(/Screenshot_(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})_([A-Za-z0-9]+)/);
  if (!match) {
    // no Screenshot_ pattern at all — either renamed manually, or not an
    // Android screenshot to begin with (e.g. iOS, or exported from an editor)
    return { present: false, timestamp: null, appName: null, likelyEdited: null };
  }

  const [, year, month, day, hour, minute, second, appName] = match;
  const timestamp = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}`);
  const appLower = appName.toLowerCase();

  const likelyEdited = KNOWN_EDITOR_APPS.some(editor => appLower.includes(editor));

  return { present: true, timestamp, appName, likelyEdited };
}

module.exports = { parseScreenshotFilename, KNOWN_EDITOR_APPS };
