/**
 * FloatTube — App orchestration
 *
 * Main player: YT IFrame JS API — good error/ready events, video title, current time.
 * Float (PiP/overlay): fresh bare <iframe> created inside the PiP window or overlay,
 *   starting at the same position. Main player's DOM is never moved.
 *
 * State machine: idle → loading → playing → floating
 *                      ↓               ↑
 *                    error          (close PiP)
 */

import {
  extractVideoId,
  loadYouTubeAPI,
  createPlayer,
  destroyPlayer,
  ytErrorMessage,
  getCurrentTime,
} from './youtube.js';

import {
  supportsDocumentPiP,
  openDocumentPiP,
  closeDocumentPiP,
  openFallbackOverlay,
  closeFallbackOverlay,
} from './pip.js';

// ── State ──────────────────────────────────────────────────────

const state = {
  current:         'idle',
  videoId:         null,
  player:          null,
  pipWindow:       null,
  overlay:         null,
  pipStartSeconds: 0,
  pipOpenedAt:     0,
};

function setState(next, patches = {}) {
  state.current = next;
  Object.assign(state, patches);
  document.body.dataset.state = next;

  inputSection.hidden   = !['idle', 'error'].includes(next);
  playerSection.hidden  = !['loading', 'playing'].includes(next);
  floatingNotice.hidden = next !== 'floating';
}

// ── DOM refs ───────────────────────────────────────────────────

const urlInput       = document.getElementById('url-input');
const playBtn        = document.getElementById('play-btn');
const clearBtn       = document.getElementById('clear-btn');
const urlError       = document.getElementById('url-error');
const inputSection   = document.getElementById('input-section');
const playerSection  = document.getElementById('player-section');
const playerWrapper  = document.getElementById('player-wrapper');
const floatBtn       = document.getElementById('float-btn');
const backBtn        = document.getElementById('back-btn');
const floatingNotice = document.getElementById('floating-notice');
const restoreBtn     = document.getElementById('restore-btn');
const newVideoBtn    = document.getElementById('new-video-btn');
const videoTitle     = document.getElementById('video-title');
const installToast   = document.getElementById('install-toast');
const installBtn     = document.getElementById('install-btn');
const dismissInstall = document.getElementById('dismiss-install-btn');

// ── Input handling ─────────────────────────────────────────────

urlInput.addEventListener('paste', () => {
  setTimeout(() => syncClearBtn(urlInput.value), 0);
});
urlInput.addEventListener('input', () => { syncClearBtn(urlInput.value); clearError(); });
urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') handlePlay(); });
clearBtn.addEventListener('click', () => { urlInput.value = ''; syncClearBtn(''); clearError(); urlInput.focus(); });
playBtn.addEventListener('click', handlePlay);

function syncClearBtn(value) { clearBtn.hidden = !value.trim(); }

// ── Error handling ─────────────────────────────────────────────

function showError(msg) {
  urlError.textContent = msg;
  urlError.hidden = false;
  setState('error');
}

function clearError() {
  urlError.hidden = true;
  urlError.textContent = '';
  if (state.current === 'error') setState('idle');
}

// ── Play flow ──────────────────────────────────────────────────

async function handlePlay() {
  const raw = urlInput.value.trim();
  if (!raw) { showError('Paste a YouTube URL to get started.'); urlInput.focus(); return; }

  const videoId = extractVideoId(raw);
  if (!videoId) { showError("Couldn't find a YouTube video ID in that URL."); urlInput.focus(); return; }

  if (state.player) { destroyPlayer(state.player); state.player = null; }
  _resetMount();
  videoTitle.textContent = '';
  setState('loading', { videoId });

  try {
    await loadYouTubeAPI();
  } catch {
    showError('Failed to load YouTube player. Check your connection and try again.');
    return;
  }

  const player = createPlayer('yt-player', videoId, {
    onReady: () => {
      setState('playing', { player });
      try {
        const data = player.getVideoData?.();
        if (data?.title) videoTitle.textContent = data.title;
      } catch { /* not critical */ }
    },
    onStateChange: () => { /* no-op — state machine driven by UI actions */ },
    onError: (e) => {
      if (state.current === 'floating') return; // spurious event during PiP transition
      destroyPlayer(player);
      state.player = null;
      showError(ytErrorMessage(e.data));
    },
  });

  state.player = player;
}

// ── Float flow ─────────────────────────────────────────────────

// pip.html writes its playhead to localStorage every 500ms (shared synchronously
// across same-origin contexts). This key is the source of truth for resuming.
const PIP_TIME_KEY = 'floattube-pip-time';

floatBtn.addEventListener('click', handleFloat);

async function handleFloat() {
  if (state.current !== 'playing') return;

  const startSeconds = getCurrentTime(state.player);
  try { state.player?.pauseVideo?.(); } catch { /* ignore */ }

  // Clear any stale value so a failed sync never resumes at an old position.
  try { localStorage.removeItem(PIP_TIME_KEY); } catch { /* ignore */ }

  if (supportsDocumentPiP()) {
    try {
      const pipWindow = await openDocumentPiP(state.videoId, startSeconds, onPiPClose);
      setState('floating', { pipWindow, pipStartSeconds: startSeconds, pipOpenedAt: Date.now() });
    } catch (err) {
      console.warn('Document PiP failed, falling back to overlay:', err.message);
      _openFallback(startSeconds);
    }
  } else {
    _openFallback(startSeconds);
  }
}

function _openFallback(startSeconds = 0) {
  const overlay = openFallbackOverlay(state.videoId, startSeconds, onPiPClose);
  setState('floating', { overlay, pipStartSeconds: startSeconds, pipOpenedAt: Date.now() });
}

// Resolve where the PiP left off:
// 1. localStorage value written by pip.html (accurate, survives any close path)
// 2. Wall-clock elapsed time since PiP opened (fallback if pip.html never synced)
function _getPipTime() {
  try {
    const stored = parseFloat(localStorage.getItem(PIP_TIME_KEY));
    if (!isNaN(stored) && stored > 0) return stored;
  } catch (_) {}

  if (state.pipOpenedAt > 0) {
    return state.pipStartSeconds + (Date.now() - state.pipOpenedAt) / 1000;
  }
  return 0;
}

function onPiPClose() {
  const seekTime = _getPipTime();
  try {
    if (seekTime > 0) state.player?.seekTo?.(seekTime, true);
    state.player?.playVideo?.();
  } catch { /* ignore */ }
  try { localStorage.removeItem(PIP_TIME_KEY); } catch { /* ignore */ }
  setState('playing', { pipWindow: null, overlay: null, pipStartSeconds: 0, pipOpenedAt: 0 });
}

// ── Restore flow ───────────────────────────────────────────────

restoreBtn.addEventListener('click', handleRestore);

function handleRestore() {
  if (state.current !== 'floating') return;
  if (state.pipWindow) closeDocumentPiP(state.pipWindow);
  else if (state.overlay) closeFallbackOverlay(state.overlay, onPiPClose);
}

// ── Back to input ──────────────────────────────────────────────

backBtn.addEventListener('click', handleBack);
newVideoBtn.addEventListener('click', handleBack);

function handleBack() {
  if (state.overlay) { closeFallbackOverlay(state.overlay, null); state.overlay = null; }
  if (state.pipWindow) { closeDocumentPiP(state.pipWindow); state.pipWindow = null; }
  if (state.player) { destroyPlayer(state.player); state.player = null; }
  _resetMount();
  videoTitle.textContent = '';
  setState('idle', { videoId: null });
  urlInput.value = '';
  syncClearBtn('');
  clearError();
  urlInput.focus();
}

function _resetMount() {
  const existing = document.getElementById('yt-player');
  if (existing && existing.tagName === 'IFRAME') existing.remove();
  if (!document.getElementById('yt-player')) {
    const mount = document.createElement('div');
    mount.id = 'yt-player';
    playerWrapper.appendChild(mount);
  }
}

// ── PWA install prompt ─────────────────────────────────────────

let deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstallPrompt = e; installToast.hidden = false; });
installBtn.addEventListener('click', async () => {
  if (!deferredInstallPrompt) return;
  installToast.hidden = true;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
});
dismissInstall.addEventListener('click', () => { installToast.hidden = true; });
window.addEventListener('appinstalled', () => { installToast.hidden = true; deferredInstallPrompt = null; });

// ── Service Worker ─────────────────────────────────────────────

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(err => console.warn('SW failed:', err));
  });
}

// ── Init ───────────────────────────────────────────────────────

setState('idle');
urlInput.focus();
