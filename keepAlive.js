// Teams Always Available - Keep Alive Content Script
window.__teamsKeepAliveInitialized || (window.__teamsKeepAliveInitialized = true, (function () {
  'use strict';

  const INTERVALS = {
    CHECK_SECONDS: 30,
    INITIAL_DELAY_MS: 100,
    MOVEMENT_MS: 5000,
    HEARTBEAT_MS: 3000,
    WAKEUP_MS: 10000,
    ACTIVITY_SECONDS: 30,
  };

  let debugMode = false;
  let isRunning = true;
  let isInitialized = false;
  let teamsVersion = null;
  let lastKnownStatus = null;
  let lastStatusSetTime = null;
  let lastActivityTime = Date.now();
  let lastHeartbeatTime = Date.now();
  let mouseIsDown = false;
  let tickCount = 0;
  let startTime = Date.now();
  let rtcConnection = null;
  let rafHandle = null;

  let moveTimer = null;
  let statusTimer = null;
  let activityTimer = null;
  let heartbeatTimer = null;
  let wakeupTimer = null;

  function log(...args) {
    if (!debugMode) return;
    const now = new Date();
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[${now.toLocaleTimeString()}.${now.getMilliseconds().toString().padStart(3, '0')} +${elapsed}s] [KeepAlive]`, ...args);
  }

  function warn(...args) {
    if (debugMode) console.warn('[KeepAlive]', ...args);
  }

  // --- Teams UI Selectors ---
  const SEL = {
    v1: {
      profileButton: '[data-tid="userInformation"]',
      presenceMenu: '[data-tid="settingsDropdownMenu"]',
      presenceDropdown: '.settings-presence-popover',
      presenceStatusButton: '[id="personal-skype-status-text"]',
      availableOption: '[data-tid="skypeStatusDropdownMenuItem-online"]',
      busyOption: '[data-tid="skypeStatusDropdownMenuItem-busy"]',
      dndOption: '[data-tid="skypeStatusDropdownMenuItem-donotdisturb"]',
      awayOption: '[data-tid="skypeStatusDropdownMenuItem-berightback"]',
      offlineOption: '[data-tid="skypeStatusDropdownMenuItem-appearoffline"]',
      currentStatus: '.ts-skype-status',
      versionIndicator: '[data-tid="userInformation"] .ts-skype-status',
    },
    v2: {
      profileButton: '[data-tid="me-control-avatar"]',
      presenceMenu: '[data-tid="me-control-menu"]',
      presencePanel: '[data-tid="me-control-set-presence-status-popover"]',
      presenceMenuItem: '[data-tid="set-presence-status-menu-item"]',
      availableOption: '[data-tid="me_control_presence_availability_available"]',
      busyOption: '[data-tid="me_control_presence_availability_busy"]',
      dndOption: '[data-tid="me_control_presence_availability_do_not_disturb"]',
      awayOption: '[data-tid="me_control_presence_availability_be_right_back"]',
      offlineOption: '[data-tid="me_control_presence_availability_appear_offline"]',
      resetOption: '[data-tid="set-availability-reset-status"]',
      currentPresence: '[data-tid="presence-indicator"]',
      presenceBadge: '.fui-Avatar__badge',
      versionIndicator: '[data-tid="me-control-avatar"] div',
    },
  };

  const CALL_PHRASES = [
    'in a call', 'in a meeting', 'on a call', 'in meeting', 'in call',
    'in gesprek', 'in overleg', 'in vergadering',
    'im gespräch', 'in einem anruf', 'in einem meeting',
    'en appel', 'en réunion', 'dans un appel',
    'en llamada', 'en reunión', 'en una llamada',
    'in chiamata', 'in riunione',
    'em chamada', 'em reunião',
    'w rozmowie', 'na spotkaniu',
    'на звонке', 'на встрече',
    'i ett samtal', 'i ett möte',
    '通話中', '会議中', '통화 중', '회의 중',
  ];

  function isCallPhrase(text) {
    if (!text || typeof text !== 'string') return false;
    const lower = text.toLowerCase();
    return CALL_PHRASES.some(p => lower.includes(p));
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function waitForEl(selector, timeout = 2000) {
    return new Promise(resolve => {
      const el = document.querySelector(selector);
      if (el) return resolve(el);
      let timer;
      const obs = new MutationObserver(() => {
        const found = document.querySelector(selector);
        if (found) { clearTimeout(timer); obs.disconnect(); resolve(found); }
      });
      obs.observe(document.body, { childList: true, subtree: true });
      timer = setTimeout(() => { obs.disconnect(); resolve(null); }, timeout);
    });
  }

  function isExtensionValid() {
    try { return !!(chrome.runtime && chrome.runtime.id); } catch { return false; }
  }

  // --- Version Detection ---
  async function detectVersion() {
    if (await waitForEl(SEL.v1.versionIndicator, 1500)) return (teamsVersion = 'v1');
    if (await waitForEl(SEL.v2.versionIndicator, 1500)) return (teamsVersion = 'v2');
    if (document.querySelector('.fui-FluentProvider') || document.querySelector('[class*="fluent"]')) return (teamsVersion = 'v2');
    if (document.querySelector('.app-header') || document.querySelector('.ts-skype-toggle')) return (teamsVersion = 'v1');
    return (teamsVersion = 'v2');
  }

  // --- Status Detection ---
  function getCurrentStatus() {
    try {
      if (!document.body) return 'unknown';
      const sel = SEL[teamsVersion || 'v2'];
      const checks = [
        sel.currentStatus, sel.presenceBadge, sel.currentPresence,
        '[class*="presence"]', '[data-tid*="presence"]',
      ].filter(Boolean);

      for (const s of checks) {
        try {
          const el = document.querySelector(s);
          if (!el) continue;
          const combined = `${el.className || ''} ${el.getAttribute('aria-label') || ''} ${el.textContent || ''}`.toLowerCase();
          if (isCallPhrase(combined)) return 'in_call';
          if (combined.includes('available') || combined.includes('online')) return 'available';
          if (combined.includes('busy')) return 'busy';
          if (combined.includes('away') || combined.includes('berightback')) return 'away';
          if (combined.includes('offline') || combined.includes('appearoffline')) return 'offline';
          if (combined.includes('dnd') || combined.includes('donotdisturb')) return 'dnd';
        } catch { continue; }
      }
      return 'unknown';
    } catch { return 'unknown'; }
  }

  function isInCallOrMeeting() {
    try {
      if (!document.body) return false;
      const callSelectors = [
        '#calling-unified-bar', '[data-tid="call-control-bar"]', '[data-tid="hangup-button"]',
        '[data-tid="call-monitor"]', '[data-tid="calling-unified-bar"]', '[data-tid="hangup-btn"]',
        '[class*="calling-controls"]', '[class*="call-monitor"]', '[class*="ts-calling-screen"]',
      ];
      for (const s of callSelectors) {
        try { if (document.querySelector(s)) return true; } catch { continue; }
      }
      return getCurrentStatus() === 'in_call';
    } catch { return false; }
  }

  // --- Presence Menu ---
  async function toggleEl(mustExist, targetSel, triggerSel) {
    try {
      const target = document.querySelector(targetSel);
      if (mustExist ? !target : target) {
        const trigger = await waitForEl(triggerSel, 2000);
        if (trigger) { trigger.click(); return waitForEl(targetSel, 2000); }
      }
      return target;
    } catch { return null; }
  }

  async function openPresenceMenu() {
    try {
      if (!document.body) return false;
      const ver = teamsVersion || 'v2';
      const sel = SEL[ver];
      if (ver === 'v1') {
        if (!await toggleEl(true, sel.presenceMenu, sel.profileButton)) return false;
        return !!(await toggleEl(true, sel.presenceDropdown, sel.presenceStatusButton));
      }
      if (!await toggleEl(true, sel.presenceMenu, sel.profileButton)) return false;
      return !!(await toggleEl(true, sel.presencePanel, sel.presenceMenuItem));
    } catch { return false; }
  }

  async function clickStatusOption(status) {
    try {
      if (!document.body) return false;
      const sel = SEL[teamsVersion || 'v2'];
      const optMap = { available: sel.availableOption, busy: sel.busyOption, away: sel.awayOption, dnd: sel.dndOption };
      const optSel = optMap[status];
      if (optSel) {
        const el = await waitForEl(optSel, 2000);
        if (el) { el.click(); return true; }
      }
      const label = { available: 'Available', busy: 'Busy', away: 'Away', dnd: 'Do Not Disturb' }[status];
      if (label) {
        const items = document.querySelectorAll('button, [role="menuitem"], [role="option"]');
        for (const item of items) {
          const text = (item.textContent || '').toLowerCase();
          const aria = (item.getAttribute('aria-label') || '').toLowerCase();
          if ((text.includes(label.toLowerCase()) || aria.includes(label.toLowerCase()))
              && !text.includes('appear') && !text.includes('reset')) {
            item.click();
            await sleep(300);
            return true;
          }
        }
      }
      return false;
    } catch { return false; }
  }

  async function closePresenceMenu() {
    try {
      if (!document.body) return;
      const ver = teamsVersion || 'v2';
      const sel = SEL[ver];
      if (ver === 'v1') {
        await toggleEl(false, sel.presenceDropdown, sel.presenceStatusButton);
        await toggleEl(false, sel.presenceMenu, sel.profileButton);
      } else {
        await toggleEl(false, sel.presencePanel, sel.presenceMenuItem);
        await toggleEl(false, sel.presenceMenu, sel.profileButton);
      }
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
      await sleep(100);
    } catch { }
  }

  async function ensureStatus(scheduledStatus = null) {
    try {
      const current = getCurrentStatus();
      log(`Status: ${current} (last: ${lastKnownStatus})`, scheduledStatus ? `[scheduled: ${scheduledStatus}]` : '');

      let respectMeetings = true;
      try {
        const s = await chrome.storage.local.get(['respectMeetingsMode']);
        respectMeetings = s.respectMeetingsMode !== false;
      } catch { }

      if (respectMeetings && isInCallOrMeeting()) {
        log('In call/meeting, skipping');
        lastKnownStatus = current;
        return true;
      }

      if (current === 'in_call' || (respectMeetings && current === 'unknown')) {
        lastKnownStatus = current;
        return true;
      }

      // Enforce scheduled status
      if (scheduledStatus && ['available', 'busy', 'away', 'dnd'].includes(scheduledStatus) && current !== scheduledStatus) {
        log(`Enforcing scheduled status: ${scheduledStatus} (current: ${current})`);
        if (await openPresenceMenu()) {
          await sleep(300);
          await clickStatusOption(scheduledStatus);
          await closePresenceMenu();
          lastKnownStatus = scheduledStatus;
          lastStatusSetTime = Date.now();
          return true;
        }
        return false;
      }

      let forceAvailable = false;
      try {
        const s = await chrome.storage.local.get(['forceAvailableMode']);
        forceAvailable = s.forceAvailableMode === true;
      } catch { }

      // If status is active, just simulate activity
      if (['available', 'busy', 'away', 'dnd'].includes(current)) {
        lastKnownStatus = current;
        if (forceAvailable && current !== 'available') {
          // Force available
          if (await openPresenceMenu()) {
            await sleep(300);
            await clickStatusOption('available');
            await closePresenceMenu();
            lastKnownStatus = 'available';
            lastStatusSetTime = Date.now();
          }
        }
        return true;
      }

      // Status is offline/unknown - set to available
      if (!await openPresenceMenu()) { await closePresenceMenu(); return false; }
      await sleep(300);
      const ok = await clickStatusOption('available');
      await closePresenceMenu();
      if (ok) { lastKnownStatus = 'available'; lastStatusSetTime = Date.now(); }
      return ok;
    } catch (e) {
      warn('Error in ensureStatus:', e);
      try { await closePresenceMenu(); } catch { }
      return false;
    }
  }

  // --- Activity Simulation ---
  const mouse = { current: { x: 0, y: 0 }, delta: { x: 0, y: 0 }, step: 0, steps: 0 };

  function doMouseStep() {
    mouse.current.x = Math.min(Math.max(mouse.current.x + mouse.delta.x, 0), window.innerWidth);
    mouse.current.y = Math.min(Math.max(mouse.current.y + mouse.delta.y, 0), window.innerHeight);
    document.body.dispatchEvent(new MouseEvent('mousemove', {
      view: window, bubbles: true, cancelable: true,
      clientX: Math.round(mouse.current.x), clientY: Math.round(mouse.current.y), isTrusted: false,
    }));
    mouse.step++;
    if (mouse.step < mouse.steps) setTimeout(doMouseStep, 2 + Math.floor(Math.random() * 3));
  }

  function simulateMouseMovement() {
    if (!document.body) return;
    if (Date.now() - lastActivityTime < 15000) return;
    if (mouseIsDown) return;
    mouse.step = 0;
    const range = 100;
    const destX = Math.min(Math.max(mouse.current.x + (Math.random() * range * 2 - range), 0), window.innerWidth);
    const destY = Math.min(Math.max(mouse.current.y + (Math.random() * range * 2 - range), 0), window.innerHeight);
    const dist = Math.max(Math.abs(destX - mouse.current.x), Math.abs(destY - mouse.current.y));
    mouse.steps = Math.min(Math.round(dist / 10) || 1, 50);
    mouse.delta = { x: (destX - mouse.current.x) / mouse.steps, y: (destY - mouse.current.y) / mouse.steps };
    log(`Mouse moving to (${Math.round(destX)}, ${Math.round(destY)}) in ${mouse.steps} steps`);
    doMouseStep();
  }

  function simulateActivity() {
    try {
      if (!document.body) return;
      document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: Math.random() * window.innerWidth, clientY: Math.random() * window.innerHeight }));
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
      window.scrollBy(0, 0);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', code: 'ShiftLeft', keyCode: 16, bubbles: true }));
      log('Activity simulated');
    } catch { }
  }

  // --- Schedule ---
  function slotMatchesMinutes(slot, mins) {
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
    // general applies to all days; day-specific adds on top
    const slots = [...(schedule.general || []), ...(schedule[days[now.getDay()]] || [])];
    return slots.some(slot => slotMatchesMinutes(slot, mins));
  }

  function getScheduledStatus(schedule) {
    if (!schedule) return null;
    const now = new Date();
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const mins = now.getHours() * 60 + now.getMinutes();
    // Day-specific takes priority over general
    const daySlots = schedule[days[now.getDay()]] || [];
    const slots = [...daySlots, ...(schedule.general || [])];
    for (const slot of slots) {
      if (!slot.start || !slot.end) continue;
      if (slotMatchesMinutes(slot, mins)) return slot.status || null;
    }
    return null;
  }

  async function shouldBeRunning() {
    const storage = await chrome.storage.local.get(['extensionEnabled', 'config']);
    if (storage.extensionEnabled === false) return { run: false };
    const config = storage.config;
    if (!config || config.manualMode === true) return { run: true, status: null };
    if (config.schedule && isWithinSchedule(config.schedule)) {
      return { run: true, status: getScheduledStatus(config.schedule) };
    }
    return { run: false };
  }

  // --- Main Loops ---
  async function keepAliveLoop() {
    if (!isRunning) return;
    if (!isExtensionValid()) { stopAll(); return; }
    try {
      const { run } = await shouldBeRunning();
      if (!run) { log('Not in schedule, skipping'); return; }
      lastHeartbeatTime = Date.now();
      try {
        await chrome.runtime.sendMessage({ action: 'setTabActive', timestamp: Date.now() });
      } catch { }
      try {
        const s = await chrome.storage.local.get(['config']);
        const config = s.config || {};
        config.lastKeepAlive = new Date().toISOString();
        await chrome.storage.local.set({ config });
      } catch { }
      simulateMouseMovement();
    } catch (e) {
      if (e.message?.includes('Extension context invalidated')) stopAll();
      warn('Error in keepAlive loop:', e);
    }
  }

  async function statusCheckLoop() {
    if (!isRunning) return;
    if (!isExtensionValid()) { stopAll(); return; }
    try {
      const { run, status } = await shouldBeRunning();
      if (!run) return;
      await ensureStatus(status);
    } catch { }
  }

  function stopAll() {
    isRunning = false;
    if (moveTimer) clearInterval(moveTimer);
    if (statusTimer) clearInterval(statusTimer);
    if (activityTimer) clearInterval(activityTimer);
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (wakeupTimer) clearInterval(wakeupTimer);
    if (rafHandle) cancelAnimationFrame(rafHandle);
    log('Stopped');
  }

  // --- Init ---
  async function initialize() {
    if (isInitialized) return;
    isInitialized = true;
    startTime = Date.now();

    try {
      const s = await chrome.storage.local.get(['debugMode']);
      debugMode = s.debugMode === true;
    } catch { }

    log('Initializing...');

    // Override visibility API to stay "visible"
    try {
      Object.defineProperty(document, 'hidden', { get: () => false, configurable: true });
      Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true });
      const origAdd = document.addEventListener.bind(document);
      document.addEventListener = (type, fn, opts) => {
        if (type === 'visibilitychange') return;
        return origAdd(type, fn, opts);
      };
      log('Visibility API overridden');
    } catch { }

    // Override IdleDetector
    try {
      if ('IdleDetector' in window) {
        window.IdleDetector = class extends EventTarget {
          constructor() { super(); this.userState = 'active'; this.screenState = 'unlocked'; }
          static async requestPermission() { return 'granted'; }
          async start() { }
        };
      }
    } catch { }

    // WebRTC anti-freeze
    try {
      if (!rtcConnection) {
        rtcConnection = new RTCPeerConnection({ iceServers: [] });
        const ch = rtcConnection.createDataChannel('keepalive', { ordered: false, maxRetransmits: 0 });
        await rtcConnection.createOffer().then(o => rtcConnection.setLocalDescription(o));
        log('WebRTC anti-freeze initialized');
      }
    } catch { }

    await detectVersion();
    log('Teams version:', teamsVersion);
    lastKnownStatus = getCurrentStatus();

    const trackActivity = (e) => {
      if (!e || e.isTrusted !== false) lastActivityTime = Date.now();
      if (e?.type === 'mousedown' || e?.type === 'touchstart') mouseIsDown = true;
      if (e?.type === 'mouseup' || e?.type === 'touchend') mouseIsDown = false;
    };
    ['mousemove', 'mousedown', 'mouseup', 'keydown', 'scroll', 'touchstart', 'touchend']
      .forEach(evt => window.addEventListener(evt, trackActivity, { passive: true }));

    if (moveTimer) clearInterval(moveTimer);
    moveTimer = setInterval(keepAliveLoop, INTERVALS.MOVEMENT_MS);

    if (statusTimer) clearInterval(statusTimer);
    statusTimer = setInterval(statusCheckLoop, INTERVALS.CHECK_SECONDS * 1000);

    if (activityTimer) clearInterval(activityTimer);
    activityTimer = setInterval(simulateActivity, INTERVALS.ACTIVITY_SECONDS * 1000);

    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(async () => {
      try {
        if (!isExtensionValid()) { stopAll(); return; }
        lastHeartbeatTime = Date.now();
        await chrome.runtime.sendMessage({ action: 'setTabActive', timestamp: Date.now() }).catch(() => { });
      } catch { }
    }, INTERVALS.HEARTBEAT_MS);

    if (wakeupTimer) clearInterval(wakeupTimer);
    wakeupTimer = setInterval(() => {
      const gap = Date.now() - lastHeartbeatTime;
      if (gap > 15000) {
        warn(`Suspension detected (${(gap / 1000).toFixed(1)}s gap), restarting...`);
        lastHeartbeatTime = Date.now();
        keepAliveLoop();
        simulateActivity();
      }
    }, INTERVALS.WAKEUP_MS);

    // requestAnimationFrame loop to prevent suspension
    let rafCount = 0;
    (function rafLoop() {
      if (!isRunning) return;
      rafCount++;
      if (rafCount % 60 === 0) lastHeartbeatTime = Date.now();
      rafHandle = requestAnimationFrame(rafLoop);
    })();

    setTimeout(() => {
      keepAliveLoop();
      statusCheckLoop();
      simulateActivity();
    }, INTERVALS.INITIAL_DELAY_MS);

    log('Ready. Intervals: Mouse(5s), Status(30s), Activity(30s), Heartbeat(3s), Wakeup(10s)');
  }

  // --- Messages ---
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'TICK_KEEPALIVE') {
      tickCount++;
      lastHeartbeatTime = Date.now();
      (async () => {
        try {
          const { run, status } = await shouldBeRunning();
          if (!run) return;
          simulateMouseMovement();
          simulateActivity();
          try {
            const s = await chrome.storage.local.get(['config']);
            const config = s.config || {};
            config.lastKeepAlive = new Date().toISOString();
            await chrome.storage.local.set({ config });
          } catch { }
          await ensureStatus(status);
        } catch { }
      })();
      sendResponse({ received: true, tickCount });
      return true;
    }
    if (msg.action === 'STOP_KEEPALIVE') stopAll();
    if (msg.action === 'RESTART_KEEPALIVE') { isRunning = true; initialize(); }
    if (msg.action === 'PING') sendResponse({ status: 'alive', isActive: isRunning, isInitialized, teamsVersion, tickCount });
    if (msg.action === 'getStatus') sendResponse({ status: getCurrentStatus() });
    if (msg.action === 'setAvailable') {
      ensureStatus().then(ok => sendResponse({ success: ok }));
      return true;
    }
    if (msg.action === 'toggle') { isRunning = msg.enabled; sendResponse({ success: true }); }
  });

  // Watch for extensionEnabled changes
  setInterval(async () => {
    try {
      const s = await chrome.storage.local.get(['extensionEnabled']);
      if (s.extensionEnabled === false && isRunning) {
        stopAll();
      } else if (s.extensionEnabled !== false && !isRunning) {
        isRunning = true;
        initialize();
      }
    } catch { }
  }, 30000);

  // Boot
  (async () => {
    await new Promise(resolve => {
      if (document.body) return resolve();
      const obs = new MutationObserver((_, o) => { if (document.body) { o.disconnect(); resolve(); } });
      obs.observe(document.documentElement, { childList: true, subtree: true });
      setTimeout(() => { obs.disconnect(); resolve(); }, 10000);
    });
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initialize);
    } else {
      initialize();
    }
  })();

  window.teamsKeepAliveDebug = {
    getStatus: getCurrentStatus,
    setAvailable: ensureStatus,
    getVersion: () => teamsVersion,
    isActive: () => isRunning,
    simulateActivity,
  };
})());
