// Finds the gym's own photos in public/img, so the site uses them when present
// and falls back to built-in graphics when not. Checked per request: drop a file in, refresh.
const fs = require('fs');
const path = require('path');

const IMG_DIR = path.join(__dirname, '..', 'public', 'img');
const EXTENSIONS = ['webp', 'jpg', 'jpeg', 'png'];

const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Returns the public URL of img/<base>.<ext> if it exists, otherwise null
function find(base) {
  for (const ext of EXTENSIONS) {
    const file = path.join(IMG_DIR, `${base}.${ext}`);
    if (fs.existsSync(file)) return `/img/${base}.${ext}`;
  }
  return null;
}

function homePhotos(classes, coaches) {
  return {
    hero: find('hero'),
    classes: Object.fromEntries(classes.map((c) => [c.key, find(`classes/${c.key}`)])),
    coaches: Object.fromEntries(coaches.map((c) => [c.name, find(`coaches/${slug(c.name)}`)])),
  };
}

const USED_FOR = {
  hero: 'Homepage background',
  'classes/wod': 'CrossFit WOD card',
  'classes/olympic': 'Olympic Lifting card',
  'classes/foundations': 'Foundations card',
  'classes/open-gym': 'Open Gym card',
};

// Credits for licensed photos (public/img/credits.json), only for files still on disk
function photoCredits() {
  let list = [];
  try {
    list = JSON.parse(fs.readFileSync(path.join(IMG_DIR, 'credits.json'), 'utf8'));
  } catch {
    return [];
  }
  return list
    .filter((c) => fs.existsSync(path.join(IMG_DIR, '..', c.file)))
    .map((c) => ({ ...c, usedFor: USED_FOR[c.slot] || c.slot }));
}

module.exports = { homePhotos, photoCredits, slug };
