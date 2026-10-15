import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium ring-offset-background transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90 shadow-sm",
        outline: "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
        // Board layer variants
        board: "bg-board-navy text-white hover:bg-board-navy/90 shadow-board font-semibold",
        "board-outline": "border-2 border-board-navy text-board-navy hover:bg-board-navy hover:text-white",
        "board-ghost": "text-board-navy hover:bg-board-navy/10",
        "board-accent": "bg-board-blue text-white hover:bg-board-blue/90 shadow-board",
        // Ops layer variants
        ops: "bg-ops-yellow text-ops-text hover:bg-ops-yellow/90 shadow-ops font-bold rounded-2xl active:scale-95",
        "ops-green": "bg-ops-green text-white hover:bg-ops-green/90 shadow-ops font-bold rounded-2xl active:scale-95",
        "ops-outline": "border-3 border-ops-yellow text-ops-text hover:bg-ops-yellow/20 font-bold rounded-2xl active:scale-95",
        "ops-ghost": "text-ops-text hover:bg-ops-yellow/20 font-semibold rounded-2xl active:scale-95",
        "ops-coral": "bg-ops-coral text-white hover:bg-ops-coral/90 shadow-sm font-bold rounded-2xl active:scale-95",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-lg px-8",
        xl: "h-14 rounded-xl px-10 text-base",
        icon: "h-10 w-10",
        // Ops-specific sizes (touch-friendly)
        "ops-lg": "h-14 px-8 text-lg rounded-2xl min-w-[120px]",
        "ops-xl": "h-16 px-10 text-xl rounded-3xl min-w-[160px]",
        "ops-full": "h-16 px-10 text-xl rounded-3xl w-full",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
