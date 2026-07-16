import type { AllowedMimeType } from './mime-allowlist.js';

export const ALLOWED_EXTENSIONS_BY_MIME = {
  'image/png': ['.png'],
  'image/webp': ['.webp'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'audio/wav': ['.wav'],
  'audio/wave': ['.wav'],
  'audio/x-wav': ['.wav'],
  'audio/ogg': ['.ogg'],
  'audio/mpeg': ['.mp3'],
  'application/json': ['.json'],
  'text/plain': ['.txt'],
} as const satisfies Record<AllowedMimeType, readonly string[]>;

export const ALLOWED_EXTENSIONS = Array.from(
  new Set(Object.values(ALLOWED_EXTENSIONS_BY_MIME).flat()),
).sort();

export const extensionOf = (filename: string): string => {
  const lower = filename.toLowerCase();
  const index = lower.lastIndexOf('.');
  return index >= 0 ? lower.slice(index) : '';
};

export const isAllowedExtensionForMime = (filename: string, mime: AllowedMimeType): boolean =>
  (ALLOWED_EXTENSIONS_BY_MIME[mime] as readonly string[]).includes(extensionOf(filename));
