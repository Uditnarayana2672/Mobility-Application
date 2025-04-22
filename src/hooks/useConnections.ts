
import { useState } from 'react';
import { generateUniqueId } from '@/lib/utils';
import { toast } from 'sonner';

export const useConnections = (currentFloor: string, onAddConnection: (connection: any) => void) => {
  const [connectingElements, setConnectingElements] = useState(false);
  const [sourceElement, setSourceElement] = useState<any>(null);
  const [connectionPoints, setConnectionPoints] = useState<{x: number, y: number}[]>([]);
  const [isMultiPointConnecting, setIsMultiPointConnecting] = useState(false);

  const startConnection = (element: any, x: number, y: number, isMultiPoint: boolean = false) => {
    setConnectingElements(true);
    setSourceElement(element);
    const startPos = { 
      x: element.x + element.width / 2, 
      y: element.y + element.height / 2 
    };
    
    if (isMultiPoint) {
      setIsMultiPointConnecting(true);
      setConnectionPoints([startPos]);
    }
  };

  const addConnectionPoint = (x: number, y: number) => {
    if (isMultiPointConnecting) {
      setConnectionPoints([...connectionPoints, { x, y }]);
    }
  };

  const finishConnection = (targetElement: any, connectionType: string) => {
    if (!sourceElement || !targetElement || targetElement.id === sourceElement.id) {
      return;
    }

    let points = [];
    if (connectionType === 'bent') {
      const midX = (sourceElement.x + targetElement.x + targetElement.width) / 2;
      const midY = (sourceElement.y + targetElement.y + targetElement.height) / 2;
      points = [
        { 
          x: sourceElement.x + sourceElement.width/2, 
          y: sourceElement.y + sourceElement.height/2 
        },
        { x: midX, y: midY },
        { 
          x: targetElement.x + targetElement.width/2, 
          y: targetElement.y + targetElement.height/2 
        }
      ];
    } else if (connectionType === 'multi') {
      points = [
        ...connectionPoints,
        { 
          x: targetElement.x + targetElement.width/2, 
          y: targetElement.y + targetElement.height/2 
        }
      ];
    }

    const connection = {
      id: generateUniqueId(),
      source: sourceElement.id,
      target: targetElement.id,
      type: connectionType,
      floor: currentFloor,
      directed: connectionType !== 'path',
      bidirectional: connectionType === 'path',
      label: '',
      distance: 0,
      travel_time: 0,
      points: points,
      width: 1,
      capacity: 1,
      wheelchair_accessible: true,
      allow_vehicles: false,
      custom_attributes: []
    };
    
    onAddConnection(connection);
    toast.success('Created new connection');
    
    resetConnection();
  };

  const resetConnection = () => {
    setConnectingElements(false);
    setSourceElement(null);
    setConnectionPoints([]);
    setIsMultiPointConnecting(false);
  };

  return {
    connectingElements,
    sourceElement,
    connectionPoints,
    isMultiPointConnecting,
    startConnection,
    addConnectionPoint,
    finishConnection,
    resetConnection
  };
};
