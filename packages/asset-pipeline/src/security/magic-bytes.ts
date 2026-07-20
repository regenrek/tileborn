import type { AllowedMimeType } from './mime-allowlist.js';

const hasPrefix = (bytes: Uint8Array, prefix: readonly number[]): boolean =>
  bytes.length >= prefix.length && prefix.every((value, index) => bytes[index] === value);

const asciiAt = (bytes: Uint8Array, offset: number, text: string): boolean => {
  if (bytes.length < offset + text.length) {
    return false;
  }
  for (let index = 0; index < text.length; index++) {
    if (bytes[offset + index] !== text.charCodeAt(index)) {
      return false;
    }
  }
  return true;
};

export const isPng = (bytes: Uint8Array): boolean =>
  hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export const isWebp = (bytes: Uint8Array): boolean =>
  bytes.length >= 12 && asciiAt(bytes, 0, 'RIFF') && asciiAt(bytes, 8, 'WEBP');

export const isJpeg = (bytes: Uint8Array): boolean =>
  bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;

export const isOgg = (bytes: Uint8Array): boolean => asciiAt(bytes, 0, 'OggS');

export const isWav = (bytes: Uint8Array): boolean =>
  bytes.length >= 12 && asciiAt(bytes, 0, 'RIFF') && asciiAt(bytes, 8, 'WAVE');

export const isMp3 = (bytes: Uint8Array): boolean => {
  if (hasPrefix(bytes, [0x49, 0x44, 0x33])) {
    return true;
  }
  return bytes.length >= 2 && bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0;
};

export const isWoff2 = (bytes: Uint8Array): boolean => asciiAt(bytes, 0, 'wOF2');

export const hasExpectedMagicBytes = (mime: AllowedMimeType, bytes: Uint8Array): boolean => {
  switch (mime) {
    case 'image/png':
      return isPng(bytes);
    case 'image/webp':
      return isWebp(bytes);
    case 'image/jpeg':
      return isJpeg(bytes);
    case 'audio/ogg':
      return isOgg(bytes);
    case 'audio/wav':
    case 'audio/wave':
    case 'audio/x-wav':
      return isWav(bytes);
    case 'audio/mpeg':
      return isMp3(bytes);
    case 'font/woff2':
      return isWoff2(bytes);
    default:
      return true;
  }
};
