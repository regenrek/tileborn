import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

/**
 * Tailwind-merge configured to recognize Tileborne's custom font-size tokens
 * (`text-2xs`, `text-caption`) as part of the `font-size` group.
 *
 * Without this, `cn("text-caption", "text-muted-foreground")` would silently
 * drop the size class because tailwind-merge groups every `text-*` together
 * by default and only the last one wins.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: ["2xs", "caption"] }],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
