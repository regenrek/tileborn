import { Schema } from "effect";

export const IMAGE_MIME_TYPES = ["image/png", "image/webp", "image/jpeg"] as const;
export const AUDIO_MIME_TYPES = ["audio/wav", "audio/wave", "audio/x-wav", "audio/ogg", "audio/mpeg"] as const;
export const DATA_MIME_TYPES = ["application/json", "text/plain"] as const;

export const ALLOWED_MIME_TYPES = [
  ...IMAGE_MIME_TYPES,
  ...AUDIO_MIME_TYPES,
  ...DATA_MIME_TYPES,
] as const;

export const AllowedMimeType = Schema.Literals(ALLOWED_MIME_TYPES);
export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

export const isAllowedMimeType = (mime: string): mime is AllowedMimeType =>
  (ALLOWED_MIME_TYPES as readonly string[]).includes(mime);

export const isImageMimeType = (mime: string): boolean =>
  (IMAGE_MIME_TYPES as readonly string[]).includes(mime);

export const isAudioMimeType = (mime: string): boolean =>
  (AUDIO_MIME_TYPES as readonly string[]).includes(mime);

export const requiresMagicByteCheck = (mime: string): boolean =>
  isImageMimeType(mime) || isAudioMimeType(mime);
