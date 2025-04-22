
import { useState } from 'react';

export const useElementDragging = (onMoveElement?: (elementId: string, deltaX: number, deltaY: number) => void) => {
  const [isDragging, setIsDragging] = useState(false);
  const [draggedElement, setDraggedElement] = useState<any>(null);
  const [dragStartPos, setDragStartPos] = useState({ x: 0, y: 0 });

  const startDragging = (element: any, x: number, y: number) => {
    setIsDragging(true);
    setDraggedElement(element);
    setDragStartPos({ x, y });
  };

  const updateDragging = (x: number, y: number) => {
    if (isDragging && draggedElement && onMoveElement) {
      const deltaX = x - dragStartPos.x;
      const deltaY = y - dragStartPos.y;
      
      if (Math.abs(deltaX) > 1 || Math.abs(deltaY) > 1) {
        onMoveElement(draggedElement.id, deltaX, deltaY);
        setDragStartPos({ x, y });
      }
    }
  };

  const stopDragging = () => {
    setIsDragging(false);
    setDraggedElement(null);
  };

  return {
    isDragging,
    draggedElement,
    startDragging,
    updateDragging,
    stopDragging
  };
};
