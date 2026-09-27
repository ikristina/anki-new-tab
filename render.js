// Turns a `cardsInfo` entry into a standalone HTML document for the sandboxed iframe.
import { invoke } from './anki.js';

const IMAGE_MIME = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
};

const AUDIO_MIME = {
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  webm: 'audio/webm',
  weba: 'audio/webm',
  flac: 'audio/flac',
  aac: 'audio/aac',
};

// Anki numbers [anki:play:q:N] / [anki:play:a:N] by scanning the fully rendered side's text
// left to right (see rslib's extract_av_tags), so `card.qSounds`/`card.aSounds` — built the
// same way from the template's field order — index into it correctly. The answer side often
// embeds the question's own markers via {{FrontSide}}, so both lists must stay available
// however either side is rendered.
const AUDIO_MARKER = /\[anki:play:([qa]):(\d+)\]/g;
const SOUND_TAG = /\[sound:([^\]]+)\]/g; // fallback: a literal tag that was never turned into a marker
const TTS_TAG = /\[anki:tts[^\]]*\](?:[\s\S]*?\[\/anki:tts\])?/g; // synthesized speech: no file to play

const isRemoteUrl = (src) => /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(src);

function safeDecode(text) {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

function extensionOf(filename) {
  return filename.split('.').pop().toLowerCase();
}

// A placeholder <audio data-file> tag for a known filename, or a small badge when the
// marker's index doesn't resolve (a template Anki's own renderer handles that this
// left-to-right approximation doesn't) or the file isn't an audio type AnkiConnect can play.
function audioPlaceholder(filename) {
  if (filename && AUDIO_MIME[extensionOf(filename)]) {
    return `<audio class="anki-audio" controls preload="none" data-file="${encodeURIComponent(filename)}"></audio>`;
  }
  if (filename) return ''; // e.g. a [sound:video.mp4] tag: not something <audio> can play
  return '<span class="audio-missing" title="This card has audio that could not be matched to a file">🔈</span>';
}

function resolveAudioMarkers(html, card) {
  return html
    .replace(AUDIO_MARKER, (_, side, index) => audioPlaceholder((side === 'q' ? card.qSounds : card.aSounds)?.[Number(index)]))
    .replace(SOUND_TAG, (_, filename) => audioPlaceholder(filename))
    .replace(TTS_TAG, '');
}

// Card HTML refers to media by bare filename, which only resolves inside Anki.
// Fetch each file from AnkiConnect and inline it as a data: URI.
async function inlineLocalMedia(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const images = [...doc.querySelectorAll('img[src]')].filter((img) => !isRemoteUrl(img.getAttribute('src')));
  const audios = [...doc.querySelectorAll('audio[data-file]')];

  await Promise.all([
    ...images.map(async (img) => {
      const filename = safeDecode(img.getAttribute('src'));
      try {
        const base64 = await invoke('retrieveMediaFile', { filename }, { timeoutMs: 10000 });
        if (base64) img.setAttribute('src', `data:${IMAGE_MIME[extensionOf(filename)] ?? 'application/octet-stream'};base64,${base64}`);
      } catch {
        // Leave the broken image rather than failing the whole card.
      }
    }),
    ...audios.map(async (audio) => {
      const filename = decodeURIComponent(audio.getAttribute('data-file'));
      audio.removeAttribute('data-file');
      try {
        const base64 = await invoke('retrieveMediaFile', { filename }, { timeoutMs: 10000 });
        if (base64) audio.setAttribute('src', `data:${AUDIO_MIME[extensionOf(filename)]};base64,${base64}`);
        else audio.replaceWith(doc.createRange().createContextualFragment(audioPlaceholder(null)));
      } catch {
        audio.replaceWith(doc.createRange().createContextualFragment(audioPlaceholder(null)));
      }
    }),
  ]);
  return doc.body.innerHTML;
}

/**
 * `side` is 'question' or 'answer'. `card` should carry `qSounds`/`aSounds` — the ordered
 * filename lists from `soundListForSide` — when the card has audio; without them, any audio
 * markers render as the "couldn't be matched" badge instead of a player.
 */
export async function buildCardDocument(card, side) {
  const body = await inlineLocalMedia(resolveAudioMarkers(card[side], card));
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
  audio.anki-audio { display: block; width: 100%; max-width: 360px; margin: 12px auto; }
  .audio-missing { opacity: 0.5; font-size: 0.7em; }
  ${card.css ?? ''}
</style>
</head>
<body class="card"><div id="qa">${body}</div></body>
</html>`;
}
