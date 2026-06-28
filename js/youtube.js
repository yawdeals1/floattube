/**
 * FloatTube — YouTube utilities
 *
 * Main player: YT IFrame JS API (for ready/error events and current time).
 * PiP/overlay: plain <iframe> created fresh in the PiP window — no postMessage,
 *              no DOM moving, starts at the same position as the main player.
 */

// ── URL parsing ────────────────────────────────────────────────

/**
 * Extract an 11-character YouTube video ID from any YouTube URL variant.
 * Returns null if no valid ID is found.
 */
export function extractVideoId(raw) {
  if (!raw || typeof raw !== 'string') return null;

  let url;
  try {
    url = new URL(raw.trim());
  } catch {
    return /^[A-Za-z0-9_-]{11}$/.test(raw.trim()) ? raw.trim() : null;
  }

  const host = url.hostname.replace(/^www\./, '').replace(/^m\./, '');

  if (host === 'youtu.be') {
    return sanitizeId(url.pathname.slice(1).split('/')[0]);
  }

  if (host === 'youtube.com' || host === 'music.youtube.com') {
    if (url.searchParams.has('v')) return sanitizeId(url.searchParams.get('v'));
    const match = url.pathname.match(/\/(embed|shorts|live|v)\/([A-Za-z0-9_-]{11})/);
    if (match) return sanitizeId(match[2]);
  }

  return null;
}

function sanitizeId(id) {
  if (!id) return null;
  const clean = id.split('?')[0].split('&')[0];
  return /^[A-Za-z0-9_-]{11}$/.test(clean) ? clean : null;
}

// ── Embed URL ──────────────────────────────────────────────────

/**
 * Build a youtube-nocookie.com embed URL.
 * @param {string} videoId
 * @param {number} [startSeconds]  Seek to this position on load.
 */
export function buildEmbedUrl(videoId, startSeconds = 0) {
  const params = new URLSearchParams({
    autoplay:       '1',
    rel:            '0',
    modestbranding: '1',
    playsinline:    '1',
    enablejsapi:    '1',
    origin:         location.origin,
  });
  if (startSeconds > 1) params.set('start', String(Math.floor(startSeconds)));
  return `https://www.youtube-nocookie.com/embed/${videoId}?${params}`;
}

// ── YT IFrame API (main player) ────────────────────────────────

let apiReadyPromise = null;

/**
 * Load the YouTube IFrame API script exactly once.
 * Returns a promise that resolves when YT.Player is ready.
 */
export function loadYouTubeAPI() {
  if (apiReadyPromise) return apiReadyPromise;

  apiReadyPromise = new Promise((resolve, reject) => {
    if (window.YT && window.YT.Player) { resolve(); return; }

    const timeout = setTimeout(() => {
      reject(new Error('YouTube IFrame API timed out'));
    }, 12000);

    window.onYouTubeIframeAPIReady = () => {
      clearTimeout(timeout);
      resolve();
    };

    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    script.onerror = () => {
      clearTimeout(timeout);
      reject(new Error('YouTube IFrame API script failed to load'));
    };
    document.head.appendChild(script);
  });

  return apiReadyPromise;
}

/**
 * Create a YT.Player in the element with the given mountId.
 * callbacks: { onReady, onStateChange, onError }
 */
export function createPlayer(mountId, videoId, callbacks = {}) {
  return new window.YT.Player(mountId, {
    videoId,
    playerVars: {
      autoplay: 1,
      rel: 0,
      modestbranding: 1,
      playsinline: 1,
      enablejsapi: 1,
      origin: location.origin,
    },
    events: {
      onReady:       callbacks.onReady       ?? (() => {}),
      onStateChange: callbacks.onStateChange ?? (() => {}),
      onError:       callbacks.onError       ?? (() => {}),
    },
  });
}

export function destroyPlayer(player) {
  if (player && typeof player.destroy === 'function') {
    try { player.destroy(); } catch { /* ignore */ }
  }
}

export function ytErrorMessage(code) {
  const msgs = {
    2:   'Invalid video URL.',
    5:   'This video cannot play in the HTML5 player.',
    100: 'Video not found or it\'s private.',
    101: 'The video owner has disabled embedding.',
    150: 'The video owner has disabled embedding.',
  };
  return msgs[code] ?? 'Playback error. Try a different video.';
}

/**
 * Safely get the current playback time from a YT.Player.
 * Returns 0 on any error.
 */
export function getCurrentTime(player) {
  try {
    return player?.getCurrentTime?.() ?? 0;
  } catch {
    return 0;
  }
}

// ── PiP iframe factory ─────────────────────────────────────────

/**
 * Create a plain embed iframe for use inside a PiP window or overlay.
 * This iframe is NOT the main YT.Player — it has no JS API.
 * It starts playing at startSeconds via the `start` URL param.
 *
 * @param {Document} targetDoc   Document to create the iframe in.
 * @param {string}   videoId
 * @param {number}   startSeconds
 */
export function createPiPIframe(targetDoc, videoId, startSeconds = 0) {
  const params = new URLSearchParams({
    autoplay:       '1',
    rel:            '0',
    modestbranding: '1',
    playsinline:    '1',
  });
  if (startSeconds > 1) params.set('start', String(Math.floor(startSeconds)));

  const iframe = targetDoc.createElement('iframe');
  iframe.src = `https://www.youtube.com/embed/${videoId}?${params}`;
  iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
  iframe.setAttribute('allowfullscreen', '');
  // The Document PiP window is about:blank, which sends a null Referer.
  // "origin" forces the browser to send Referer: http://localhost:8080/ so YouTube accepts the embed.
  iframe.referrerPolicy = 'origin';
  iframe.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:none;display:block;';
  return iframe;
}
