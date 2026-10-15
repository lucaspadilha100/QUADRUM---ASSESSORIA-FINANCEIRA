// Portado de carbohub-gestao/apps/crm/src/components/kanban/KanbanDnd.tsx.
import { ReactNode } from "react";
import { useDraggable, useDroppable, DragOverlay } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@/lib/utils";

interface DraggableCardProps {
  id: string;
  data?: Record<string, unknown>;
  children: ReactNode;
  disabled?: boolean;
}

export function DraggableCard({ id, data, children, disabled }: DraggableCardProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id, data, disabled });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        opacity: isDragging ? 0 : undefined,
        pointerEvents: isDragging ? "none" : undefined,
      }}
      className="touch-none"
      {...listeners}
      {...attributes}
    >
      {children}
    </div>
  );
}

interface DroppableColumnProps {
  id: string;
  children: ReactNode;
}

export function DroppableColumn({ id, children }: DroppableColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "min-h-[80px] rounded-lg transition-colors duration-150",
        isOver && "ring-2 ring-primary/60 bg-primary/5"
      )}
    >
      {children}
    </div>
  );
}

export function KanbanDragOverlay({ children }: { children: ReactNode | null }) {
  return (
    <DragOverlay dropAnimation={null}>
      {children ? (
        <div className="rotate-2 opacity-90 shadow-xl scale-105 cursor-grabbing pointer-events-none">
          {children}
        </div>
      ) : null}
    </DragOverlay>
  );
}
