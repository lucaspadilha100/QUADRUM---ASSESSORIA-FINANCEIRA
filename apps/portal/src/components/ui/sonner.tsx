import { Toaster as Sonner, toast } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="light"
      className="toaster group"
      position="top-right"
      gap={8}
      toastOptions={{
        duration: 4000,
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground " +
            "group-[.toaster]:border group-[.toaster]:border-border/60 " +
            "group-[.toaster]:shadow-toast group-[.toaster]:rounded-xl " +
            "group-[.toaster]:backdrop-blur-sm " +
            "data-[type=success]:group-[.toaster]:border-success/30 data-[type=success]:group-[.toaster]:bg-success/5 " +
            "data-[type=warning]:group-[.toaster]:border-warning/30 data-[type=warning]:group-[.toaster]:bg-warning/5 " +
            "data-[type=error]:group-[.toaster]:border-destructive/30 data-[type=error]:group-[.toaster]:bg-destructive/5 " +
            "data-[type=info]:group-[.toaster]:border-blue-500/20 data-[type=info]:group-[.toaster]:bg-blue-500/5",
          title: "group-[.toast]:font-semibold group-[.toast]:text-sm",
          description: "group-[.toast]:text-muted-foreground group-[.toast]:text-xs",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground group-[.toast]:rounded-lg group-[.toast]:text-xs group-[.toast]:font-medium",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground group-[.toast]:rounded-lg group-[.toast]:text-xs",
          closeButton: "group-[.toast]:border-border/50 group-[.toast]:bg-background hover:group-[.toast]:bg-muted",
        },
      }}
      {...props}
    />
  );
};

export { Toaster, toast };
