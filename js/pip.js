/**
 * FloatTube — Picture-in-Picture module
 *
 * Creates a fresh <iframe> inside the PiP window or fallback overlay,
 * starting at the same position as the main player. The main player's
 * DOM is never moved, so there is no postMessage disruption.
 *
 * Primary path:  Document Picture-in-Picture API (Chrome 116+)
 * Fallback path: CSS position:fixed overlay with JS drag + CSS resize
 */


// ── Feature detection ──────────────────────────────────────────

export function supportsDocumentPiP() {
  return (
    'documentPictureInPicture' in window &&
    typeof window.documentPictureInPicture.requestWindow === 'function'
  );
}

// ── Document PiP ──────────────────────────────────────────────

/**
 * Open the Document PiP window and embed a fresh YouTube iframe inside it.
 *
 * @param {string}   videoId
 * @param {number}   startSeconds  Current playback time from the main player.
 * @param {function} onClose       Called when the PiP window closes.
 * @returns {Promise<Window>}      The PiP window object.
 */
export async function openDocumentPiP(videoId, startSeconds, onClose) {
  const pipWindow = await window.documentPictureInPicture.requestWindow({
    width:  480,
    height: 294,
  });

  const style = pipWindow.document.createElement('style');
  style.textContent = '*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; } body { background: #000; overflow: hidden; width: 100vw; height: 100vh; } iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: none; display: block; }';
  pipWindow.document.head.appendChild(style);

  // Load pip.html inside an iframe rather than directly embedding YouTube.
  // The PiP window document is about:blank (Chrome blocks navigating it), so
  // YouTube's embed player sees a null Referer and throws Error 153.
  // An iframe pointing to our own origin gives the nested YouTube embed a
  // real Referer (http://localhost:8080/pip.html) that YouTube accepts.
  const url = new URL('/pip.html', location.origin);
  url.searchParams.set('v', videoId);
  if (startSeconds > 1) url.searchParams.set('t', String(Math.floor(startSeconds)));

  const wrapper = pipWindow.document.createElement('iframe');
  wrapper.src = url.toString();
  wrapper.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
  wrapper.setAttribute('allowfullscreen', '');
  pipWindow.document.body.appendChild(wrapper);

  pipWindow.addEventListener('pagehide', () => onClose?.());

  return pipWindow;
}

export function closeDocumentPiP(pipWindow) {
  if (pipWindow && !pipWindow.closed) {
    pipWindow.close();
  }
}

// ── Fallback overlay ───────────────────────────────────────────

/**
 * Open a draggable, resizable fixed overlay with a fresh YouTube iframe.
 *
 * @param {string}   videoId
 * @param {number}   startSeconds
 * @param {function} onClose
 * @returns {HTMLElement}  The overlay element.
 */
export function openFallbackOverlay(videoId, startSeconds, onClose) {
  const overlay = document.createElement('div');
  overlay.className = 'pip-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-label', 'Floating video player');

  // Header — drag handle + close button
  const header = document.createElement('div');
  header.className = 'pip-overlay__header';

  const label = document.createElement('span');
  label.className = 'pip-overlay__label';
  label.innerHTML = '<span class="pip-overlay__label-dot"></span>Floating';
  label.setAttribute('aria-hidden', 'true');

  const closeBtn = document.createElement('button');
  closeBtn.className = 'pip-overlay__close';
  closeBtn.setAttribute('aria-label', 'Close floating player');
  closeBtn.innerHTML = `
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none"
         stroke="currentColor" stroke-width="1.75" stroke-linecap="round"
         aria-hidden="true">
      <path d="M1 1l12 12M13 1L1 13"/>
    </svg>
  `;
  closeBtn.addEventListener('click', () => closeFallbackOverlay(overlay, onClose));

  header.appendChild(label);
  header.appendChild(closeBtn);
  overlay.appendChild(header);

  // Load pip.html so the overlay player participates in postMessage time sync.
  const pipUrl = new URL('/pip.html', location.origin);
  pipUrl.searchParams.set('v', videoId);
  if (startSeconds > 1) pipUrl.searchParams.set('t', String(Math.floor(startSeconds)));
  const iframe = document.createElement('iframe');
  iframe.src = pipUrl.toString();
  iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
  iframe.setAttribute('allowfullscreen', '');
  iframe.style.cssText = 'position:absolute;top:34px;left:0;right:0;bottom:0;width:100%;height:calc(100% - 34px);border:none;display:block;';
  overlay.appendChild(iframe);

  document.body.appendChild(overlay);
  _makeDraggable(overlay, header);
  _makeDraggableTouch(overlay, header);

  return overlay;
}

export function closeFallbackOverlay(overlay, onClose) {
  overlay.remove();
  onClose?.();
}

// ── Drag (mouse) ───────────────────────────────────────────────

function _makeDraggable(el, handle) {
  handle.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || e.target.closest('button')) return;
    e.preventDefault();

    const rect = el.getBoundingClientRect();
    const offsetX = e.clientX - rect.left;
    const offsetY = e.clientY - rect.top;

    function onMove(e) {
      const x = e.clientX - offsetX;
      const y = e.clientY - offsetY;
      el.style.left   = Math.max(0, Math.min(x, window.innerWidth  - el.offsetWidth))  + 'px';
      el.style.top    = Math.max(0, Math.min(y, window.innerHeight - el.offsetHeight)) + 'px';
      el.style.right  = 'auto';
      el.style.bottom = 'auto';
    }

    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

// ── Drag (touch) ───────────────────────────────────────────────

function _makeDraggableTouch(el, handle) {
  let offsetX = 0, offsetY = 0;

  handle.addEventListener('touchstart', (e) => {
    if (e.target.closest('button')) return;
    const t = e.touches[0];
    const rect = el.getBoundingClientRect();
    offsetX = t.clientX - rect.left;
    offsetY = t.clientY - rect.top;
  }, { passive: true });

  handle.addEventListener('touchmove', (e) => {
    e.preventDefault();
    const t = e.touches[0];
    const x = t.clientX - offsetX;
    const y = t.clientY - offsetY;
    el.style.left   = Math.max(0, Math.min(x, window.innerWidth  - el.offsetWidth))  + 'px';
    el.style.top    = Math.max(0, Math.min(y, window.innerHeight - el.offsetHeight)) + 'px';
    el.style.right  = 'auto';
    el.style.bottom = 'auto';
  }, { passive: false });
}
