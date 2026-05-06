// Teams Availability Scheduler - Popup Script

const DEFAULT_CONFIG = {
  manualMode: false,
  forceAvailableMode: false,
  respectMeetingsMode: true,
  schedule: {
    general: [],
    monday: [], tuesday: [], wednesday: [], thursday: [],
    friday: [], saturday: [], sunday: [],
  },
  lastKeepAlive: null,
};

const ALL_KEYS = [
  { key: 'general' },
  { key: 'monday' }, { key: 'tuesday' }, { key: 'wednesday' }, { key: 'thursday' },
  { key: 'friday' }, { key: 'saturday' }, { key: 'sunday' },
];

let config = { ...DEFAULT_CONFIG };

async function loadConfig() {
  const storage = await chrome.storage.local.get(['config', 'extensionEnabled', 'debugMode']);
  if (storage.config) {
    config = { ...DEFAULT_CONFIG, ...storage.config };
    if (!config.schedule) config.schedule = DEFAULT_CONFIG.schedule;
    for (const { key } of ALL_KEYS) {
      if (!Array.isArray(config.schedule[key])) config.schedule[key] = [];
    }
  }
  return storage;
}

async function saveConfig() {
  await chrome.storage.local.set({ config });
  chrome.runtime.sendMessage({ action: 'configChanged' }).catch(() => {});
}

function formatLastKeepAlive(isoString) {
  if (!isoString) return 'Never';
  try {
    const date = new Date(isoString);
    const diff = Math.floor((Date.now() - date) / 1000);
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    return date.toLocaleTimeString();
  } catch { return 'Unknown'; }
}

async function updateStatus() {
  const teamsStatusEl = document.getElementById('teamsStatus');
  const lastKeepAliveEl = document.getElementById('lastKeepAlive');
  const extensionStatusEl = document.getElementById('extensionStatus');
  const openTeamsBtn = document.getElementById('openTeamsBtn');

  try {
    const tabs = await chrome.tabs.query({
      url: [
        'https://*.teams.microsoft.com/*',
        'https://*.teams.microsoft.com.mcas.ms/*',
        'https://*.teams.microsoft.us/*',
        'https://*.teams.microsoft.us.mcas.ms/*',
        'https://teams.cloud.microsoft/*',
      ],
    });

    if (tabs.length > 0) {
      teamsStatusEl.textContent = `${tabs.length} tab${tabs.length > 1 ? 's' : ''} open`;
      teamsStatusEl.className = 'status-value status-success';
      openTeamsBtn.style.display = 'none';
    } else {
      teamsStatusEl.textContent = 'No tabs open';
      teamsStatusEl.className = 'status-value status-warning';
      openTeamsBtn.style.display = 'block';
    }

    const storage = await chrome.storage.local.get(['config', 'extensionEnabled']);
    const cfg = storage.config || {};
    lastKeepAliveEl.textContent = formatLastKeepAlive(cfg.lastKeepAlive);

    const enabled = storage.extensionEnabled !== false;
    extensionStatusEl.textContent = enabled ? 'Active' : 'Disabled';
    extensionStatusEl.className = `status-value ${enabled ? 'status-success' : 'status-error'}`;
  } catch {
    teamsStatusEl.textContent = 'Error';
    teamsStatusEl.className = 'status-value status-error';
  }
}

async function init() {
  const storage = await loadConfig();

  const enabledCheckbox = document.getElementById('extensionEnabled');
  enabledCheckbox.checked = storage.extensionEnabled !== false;
  enabledCheckbox.addEventListener('change', async () => {
    await chrome.storage.local.set({ extensionEnabled: enabledCheckbox.checked });
    chrome.runtime.sendMessage({ action: 'configChanged' }).catch(() => {});
    updateStatus();
  });

  const manualModeCheckbox = document.getElementById('manualMode');
  manualModeCheckbox.checked = config.manualMode === true;
  manualModeCheckbox.addEventListener('change', async () => {
    config.manualMode = manualModeCheckbox.checked;
    await saveConfig();
  });

  const forceAvailableCheckbox = document.getElementById('forceAvailableMode');
  forceAvailableCheckbox.checked = config.forceAvailableMode === true;
  forceAvailableCheckbox.addEventListener('change', async () => {
    config.forceAvailableMode = forceAvailableCheckbox.checked;
    await saveConfig();
  });

  const respectMeetingsCheckbox = document.getElementById('respectMeetingsMode');
  respectMeetingsCheckbox.checked = config.respectMeetingsMode !== false;
  respectMeetingsCheckbox.addEventListener('change', async () => {
    config.respectMeetingsMode = respectMeetingsCheckbox.checked;
    await saveConfig();
  });

  const debugCheckbox = document.getElementById('debugMode');
  debugCheckbox.checked = storage.debugMode === true;
  debugCheckbox.addEventListener('change', async () => {
    await chrome.storage.local.set({ debugMode: debugCheckbox.checked });
  });

  document.getElementById('openTeamsBtn').addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://teams.microsoft.com' });
  });

  document.getElementById('openSchedulerBtn').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('scheduler.html') });
  });

  document.getElementById('donateBtn').addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://buymeacoffee.com/leandromqrs' });
  });

  await updateStatus();
  setInterval(updateStatus, 5000);
}

document.addEventListener('DOMContentLoaded', init);
