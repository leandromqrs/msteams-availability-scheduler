let DEBUG = false;

const DEFAULT_CONFIG = {
  manualMode: false,
  forceAvailableMode: false,
  respectMeetingsMode: true,
  schedule: { monday: [], tuesday: [], wednesday: [], thursday: [], friday: [], saturday: [], sunday: [] },
  lastKeepAlive: null,
};

const ALARM_NAME = 'evaluateSchedule';
const KEEPALIVE_ALARM = 'keepAliveAlarm';

let serviceWorkerStartTime = Date.now();
let lastHeartbeatReceived = Date.now();
let heartbeatCount = 0;

function ts() {
  const now = new Date();
  const elapsed = ((Date.now() - serviceWorkerStartTime) / 1000).toFixed(1);
  return `[${now.toLocaleTimeString()}.${now.getMilliseconds().toString().padStart(3, '0')} +${elapsed}s]`;
}

async function loadDebugMode() {
  try {
    const s = await chrome.storage.local.get(['debugMode']);
    DEBUG = s.debugMode === true;
  } catch { }
}

async function ensureOffscreenDocument() {
  try {
    const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
    if (contexts.length > 0) return;
    await chrome.offscreen.createDocument({
      url: 'src/html/offscreen.html',
      reasons: ['AUDIO_PLAYBACK'],
      justification: 'Keep service worker alive to prevent Chrome throttling',
    });
    DEBUG && console.log(ts(), '[Background] Offscreen document created');
  } catch (e) {
    DEBUG && console.warn(ts(), '[Background] Offscreen error:', e.message);
  }
}

async function ensureAlarms() {
  if (!await chrome.alarms.get(ALARM_NAME)) {
    await chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 });
    DEBUG && console.log(ts(), '[Background] Main alarm created');
  }
  if (!await chrome.alarms.get(KEEPALIVE_ALARM)) {
    await chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.25 });
    DEBUG && console.log(ts(), '[Background] Keep-alive alarm created');
  }
}

function slotActive(slot, mins) {
  if (!slot.start || !slot.end) return false;
  const [sh, sm] = slot.start.split(':').map(Number);
  const [eh, em] = slot.end.split(':').map(Number);
  const s = sh * 60 + sm, e = eh * 60 + em;
  return s <= e ? mins >= s && mins <= e : mins >= s || mins <= e;
}

function isWithinSchedule(schedule) {
  if (!schedule) return false;
  const now = new Date();
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const mins = now.getHours() * 60 + now.getMinutes();
  const slots = [...(schedule.general || []), ...(schedule[days[now.getDay()]] || [])];
  return slots.some(slot => slotActive(slot, mins));
}

async function updateIconState() {
  try {
    const storage = await chrome.storage.local.get(['extensionEnabled', 'config']);
    let active = false;
    if (storage.extensionEnabled !== false && storage.config) {
      const config = storage.config;
      if (config.manualMode === true) {
        active = true;
      } else if (config.schedule) {
        active = isWithinSchedule(config.schedule);
      }
    }
    await chrome.action.setIcon({
      path: active
        ? { 16: 'src/images/teamsIconWithGreen.png', 48: 'src/images/teamsIconWithGreen.png', 128: 'src/images/teamsIconWithGreen.png' }
        : { 16: 'src/images/icon16.png', 48: 'src/images/icon48.png', 128: 'src/images/icon128.png' },
    }).catch(() => { });
  } catch { }
}

async function sendTickToTeamsTabs() {
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
    for (const tab of tabs) {
      if (tab.id) {
        chrome.tabs.sendMessage(tab.id, { action: 'TICK_KEEPALIVE', timestamp: Date.now() }).catch(() => { });
      }
    }
    DEBUG && tabs.length > 0 && console.log(ts(), `[Background] Sent TICK to ${tabs.length} Teams tab(s)`);
  } catch { }
}

async function initializeServiceWorker() {
  try {
    serviceWorkerStartTime = Date.now();
    lastHeartbeatReceived = Date.now();
    await loadDebugMode();
    DEBUG && console.log(ts(), '[Background] Initializing...');
    await ensureOffscreenDocument();
    await ensureAlarms();
    const storage = await chrome.storage.local.get(['config', 'extensionEnabled']);
    if (!storage.config) {
      await chrome.storage.local.set({ config: DEFAULT_CONFIG, extensionEnabled: true });
    }
    await updateIconState();
    DEBUG && console.log(ts(), '[Background] Initialized');
  } catch (e) {
    DEBUG && console.error(ts(), '[Background] Init error:', e);
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  await initializeServiceWorker();
});

chrome.runtime.onStartup.addListener(async () => {
  await initializeServiceWorker();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  await loadDebugMode();
  if (alarm.name === ALARM_NAME) {
    await updateIconState();
  }
  if (alarm.name === KEEPALIVE_ALARM) {
    await sendTickToTeamsTabs();
    const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
    if (contexts.length === 0) await ensureOffscreenDocument();
    heartbeatCount++;
    DEBUG && heartbeatCount % 4 === 0 && console.log(ts(), `[Background] Keep-alive tick #${heartbeatCount}`);
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'setTabActive') {
    lastHeartbeatReceived = Date.now();
    chrome.storage.local.set({ _lastContentScriptActivity: Date.now() }).catch(() => { });
    sendResponse({ success: true, timestamp: Date.now() });
    return true;
  }
  if (msg.action === 'offscreenHeartbeat') {
    lastHeartbeatReceived = Date.now();
    heartbeatCount++;
    chrome.storage.local.set({ _lastServiceWorkerActivity: Date.now() }).catch(() => { });
    if (heartbeatCount % 5 === 0) sendTickToTeamsTabs();
    sendResponse({ status: 'alive', count: heartbeatCount });
    return true;
  }
  if (msg.action === 'configChanged' || msg.action === 'updateConfig') {
    updateIconState().then(() => sendResponse({ success: true }));
    return true;
  }
  if (msg.action === 'injectNow' || msg.action === 'reevaluateKeepAlive') {
    updateIconState().then(() => sendResponse({ success: true }));
    return true;
  }
});
