import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { Button } from "./button.js"

describe("Button", () => {
  it("renders label text", () => {
    render(<Button>Save map</Button>)
    expect(screen.getByRole("button", { name: "Save map" })).toBeInTheDocument()
  })
})
