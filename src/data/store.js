/**
 * Simple JSON file-based data store.
 * No database required — data lives in data/db.json.
 */

const fs   = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'db.json');

const DEFAULTS = {
  clients:   [],
  templates: [],
  emails:    [],   // queue items (pending → approved → sent)
  followups: [],
  settings:  {
    followupDays: [
      parseInt(process.env.FOLLOWUP_1_DAYS || '3',  10),
      parseInt(process.env.FOLLOWUP_2_DAYS || '7',  10),
      parseInt(process.env.FOLLOWUP_3_DAYS || '14', 10)
    ],
    timezone: 'UTC'
  }
};

function load() {
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify(DEFAULTS, null, 2));
    return JSON.parse(JSON.stringify(DEFAULTS));
  }
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch {
    return JSON.parse(JSON.stringify(DEFAULTS));
  }
}

function save(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

// Proxy so callers can do: db.clients, db.save()
function getStore() {
  const data = load();
  return {
    get clients()   { return load().clients;   },
    get templates() { return load().templates; },
    get emails()    { return load().emails;    },
    get followups() { return load().followups; },
    get settings()  { return load().settings;  },

    save(patch) {
      const current = load();
      const updated = Object.assign({}, current, patch);
      save(updated);
    }
  };
}

module.exports = getStore();
