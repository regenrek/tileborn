import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { Kbd, KbdGroup } from "./kbd.js"

describe("Kbd", () => {
  it("renders a keyboard key with data-slot", () => {
    render(<Kbd>Ctrl</Kbd>)
    const kbd = screen.getByText("Ctrl")
    expect(kbd.tagName).toBe("KBD")
    expect(kbd).toHaveAttribute("data-slot", "kbd")
  })

  it("groups keys in KbdGroup", () => {
    render(
      <KbdGroup>
        <Kbd>⌘</Kbd>
        <Kbd>K</Kbd>
      </KbdGroup>
    )
    expect(screen.getByText("⌘")).toBeInTheDocument()
    expect(screen.getByText("K")).toBeInTheDocument()
  })
})
