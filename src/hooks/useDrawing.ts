
import { useState } from 'react';
import { generateUniqueId } from '@/lib/utils';
import { toast } from 'sonner';

export const useDrawing = (currentFloor: string, onAddElement: (element: any) => void) => {
  const [drawing, setDrawing] = useState(false);
  const [startPoint, setStartPoint] = useState({ x: 0, y: 0 });
  const [currentPoint, setCurrentPoint] = useState({ x: 0, y: 0 });

  const startDrawing = (x: number, y: number) => {
    setDrawing(true);
    setStartPoint({ x, y });
    setCurrentPoint({ x, y });
  };

  const updateDrawing = (x: number, y: number) => {
    if (drawing) {
      setCurrentPoint({ x, y });
    }
  };

  const finishDrawing = (selectedTool: string) => {
    if (!drawing) return;
    
    const width = Math.abs(currentPoint.x - startPoint.x);
    const height = Math.abs(currentPoint.y - startPoint.y);
    
    if (width > 5 && height > 5) {
      const defaultProps = {
        id: generateUniqueId(),
        type: selectedTool,
        x: Math.min(startPoint.x, currentPoint.x),
        y: Math.min(startPoint.y, currentPoint.y),
        width,
        height,
        name: `New ${selectedTool}`,
        floor: currentFloor,
        tags: [],
        custom_attributes: [],
        capacity: 0
      };
      
      const element = selectedTool === 'wall' 
        ? { 
            ...defaultProps, 
            wallThickness: 1,
            label: 'Wall'
          } 
        : defaultProps;
      
      onAddElement(element);
      toast.success(`Added new ${selectedTool}`);
    }
    
    setDrawing(false);
  };

  return {
    drawing,
    startPoint,
    currentPoint,
    startDrawing,
    updateDrawing,
    finishDrawing
  };
};
