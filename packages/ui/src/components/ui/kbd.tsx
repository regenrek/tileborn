import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "../../lib/utils.js"

const kbdVariants = cva(
  "pointer-events-none inline-flex h-5 min-h-5 min-w-5 items-center justify-center gap-1 rounded-kbd border px-1.5 font-mono text-2xs font-medium select-none",
  {
    variants: {
      variant: {
        default: "border-border bg-muted text-muted-foreground",
        ghost:
          "border-transparent bg-muted-foreground/10 text-muted-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Kbd({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"kbd"> & VariantProps<typeof kbdVariants>) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(kbdVariants({ variant }), className)}
      {...props}
    />
  )
}

function KbdGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="kbd-group"
      className={cn("inline-flex items-center gap-1", className)}
      {...props}
    />
  )
}

export { Kbd, KbdGroup, kbdVariants }
