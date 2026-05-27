import { describe, expect, it } from "vitest"

import { cn } from "./lib/utils.js"
import { focusRing, statusSurface, typography } from "./tokens.js"

describe("tokens", () => {
  it("exports token-backed typography classes without px literals", () => {
    expect(typography.micro).toContain("text-2xs")
    expect(typography.caption).toContain("text-caption")
    expect(typography.sectionLabel).not.toMatch(/\[\d+px\]/)
  })

  it("exports focus ring utilities", () => {
    expect(focusRing.sm).toBe("focus-ring")
    expect(focusRing.md).toBe("focus-ring-lg")
  })

  it("exports semantic status surfaces", () => {
    expect(statusSurface.success).toContain("text-success")
    expect(statusSurface.warning).toContain("text-warning")
    expect(statusSurface.info).toContain("text-info")
    expect(statusSurface.error).toContain("text-destructive")
  })

  it("exposes the editor typography contract on `typography`", () => {
    expect(typography.panelTitle).toContain("text-caption")
    expect(typography.panelTitle).toContain("uppercase")
    expect(typography.subsectionLabel).toContain("text-2xs")
    expect(typography.rowTitle).toContain("text-caption")
    expect(typography.rowMeta).toContain("text-2xs")
    expect(typography.inlineHint).toContain("text-2xs")
    expect(typography.bodyDense).toContain("text-caption")
  })
})

describe("cn()", () => {
  it("preserves text-caption when combined with text-muted-foreground", () => {
    const merged = cn("text-caption", "text-muted-foreground")
    expect(merged).toContain("text-caption")
    expect(merged).toContain("text-muted-foreground")
  })

  it("preserves text-2xs when combined with text-muted-foreground", () => {
    const merged = cn("text-2xs", "text-muted-foreground")
    expect(merged).toContain("text-2xs")
    expect(merged).toContain("text-muted-foreground")
  })

  it("still dedupes conflicting custom font sizes (last wins)", () => {
    const merged = cn("text-caption", "text-2xs")
    expect(merged).toBe("text-2xs")
  })

  it("preserves editor typography tokens through cn()", () => {
    const merged = cn("min-w-0 truncate", typography.panelTitle)
    expect(merged).toContain("text-caption")
    expect(merged).toContain("uppercase")
    expect(merged).toContain("text-muted-foreground")
  })
})
