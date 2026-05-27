import * as React from "react"

import { cn } from "../../lib/utils.js"

function Progress({
  className,
  value = 0,
  ...props
}: React.ComponentProps<"div"> & {
  readonly value?: number
}) {
  const clamped = Math.min(100, Math.max(0, value))

  return (
    <div
      data-slot="progress"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clamped}
      className={cn(
        "relative h-2 w-full overflow-hidden rounded-full bg-primary/15",
        className
      )}
      {...props}
    >
      <div
        className="h-full rounded-full transition-all duration-300 ease-out"
        style={{
          width: `${clamped}%`,
          backgroundImage: "linear-gradient(to right, var(--destructive), var(--success))",
        }}
      />
    </div>
  )
}

export { Progress }
