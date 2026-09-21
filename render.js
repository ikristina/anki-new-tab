// Turns a `cardsInfo` entry into a standalone HTML document for the sandboxed iframe.
import { invoke } from './anki.js';

const MIME_BY_EXTENSION = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
};

// Audio isn't supported yet; drop the placeholders so they don't show as raw text.
const AUDIO_PLACEHOLDER = /\[(?:anki:play:[^\]]*|sound:[^\]]*)\]/g;

const isRemoteUrl = (src) => /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(src);

function safeDecode(text) {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

function mimeFor(filename) {
  const extension = filename.split('.').pop().toLowerCase();
  return MIME_BY_EXTENSION[extension] ?? 'application/octet-stream';
}

// Card HTML refers to media by bare filename, which only resolves inside Anki.
// Fetch each file from AnkiConnect and inline it as a data: URI.
async function inlineLocalImages(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const images = [...doc.querySelectorAll('img[src]')].filter(
    (img) => !isRemoteUrl(img.getAttribute('src')),
  );

  await Promise.all(
    images.map(async (img) => {
      const filename = safeDecode(img.getAttribute('src'));
      try {
        const base64 = await invoke('retrieveMediaFile', { filename }, { timeoutMs: 10000 });
        if (base64) img.setAttribute('src', `data:${mimeFor(filename)};base64,${base64}`);
      } catch {
        // Leave the broken image rather than failing the whole card.
      }
    }),
  );
  return doc.body.innerHTML;
}

/** `side` is 'question' or 'answer'. */
export async function buildCardDocument(card, side) {
  const body = await inlineLocalImages(card[side].replace(AUDIO_PLACEHOLDER, ''));
  // Default colours come first so the note type's own CSS can override them.
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="color-scheme" content="light">
<style>
  html, body { margin: 0; }
  /* Centre the card in the frame, both ways; short cards sit in the middle of the frame. */
  body { box-sizing: border-box; min-height: 100vh; display: flex; align-items: center; justify-content: center;
         padding: 32px 40px; background: #fff; color: #111; font: 20px/1.5 system-ui, sans-serif; text-align: center; }
  /* A single wrapper keeps inline content together as one flex item. */
  #qa { width: 100%; zoom: 1.25; }
  img { max-width: 100%; }
  ${card.css ?? ''}
</style>
</head>
<body class="card"><div id="qa">${body}</div></body>
</html>`;
}
