// Offscreen document - keeps service worker alive via audio
const HEARTBEAT_MS = 3000;
let heartbeatCount = 0;
let isRunning = false;
let consecutiveFailures = 0;
let heartbeatIntervalId = null;
let healthCheckIntervalId = null;
let lastHeartbeatSent = Date.now();
let audioContext = null;

function playSilentAudio() {
  try {
    if (!audioContext || audioContext.state === 'closed') {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioContext.state === 'suspended') audioContext.resume();
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    gain.gain.value = 0.0001;
    osc.connect(gain);
    gain.connect(audioContext.destination);
    osc.frequency.value = 1;
    osc.type = 'sine';
    osc.start(audioContext.currentTime);
    osc.stop(audioContext.currentTime + 0.001);
  } catch { }
}

function initAudio() {
  try {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    setInterval(playSilentAudio, 1000);
    playSilentAudio();
    return true;
  } catch { return false; }
}

function sendHeartbeat() {
  heartbeatCount++;
  lastHeartbeatSent = Date.now();
  chrome.runtime.sendMessage({ action: 'offscreenHeartbeat', count: heartbeatCount, timestamp: Date.now() })
    .then(() => { consecutiveFailures = 0; })
    .catch(() => { consecutiveFailures++; });
}

function startHeartbeat() {
  if (isRunning) return;
  isRunning = true;
  initAudio();
  if (heartbeatIntervalId) clearInterval(heartbeatIntervalId);
  heartbeatIntervalId = setInterval(sendHeartbeat, HEARTBEAT_MS);
  if (healthCheckIntervalId) clearInterval(healthCheckIntervalId);
  healthCheckIntervalId = setInterval(() => {
    if (Date.now() - lastHeartbeatSent > 10000) {
      if (heartbeatIntervalId) clearInterval(heartbeatIntervalId);
      heartbeatIntervalId = setInterval(sendHeartbeat, HEARTBEAT_MS);
      sendHeartbeat();
    }
  }, 15000);
  sendHeartbeat();
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'ping') {
    sendResponse({ status: 'alive', heartbeatCount, isRunning, consecutiveFailures, source: 'offscreen' });
    return true;
  }
  if (msg.action === 'start') {
    startHeartbeat();
    sendResponse({ status: 'started' });
    return true;
  }
  if (msg.action === 'reset') {
    consecutiveFailures = 0;
    sendResponse({ status: 'reset' });
    return true;
  }
});

startHeartbeat();
