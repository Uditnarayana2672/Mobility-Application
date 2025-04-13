
import { useRef, useState, useEffect } from 'react';
import BlueprintCanvas from './BlueprintCanvas';
import BlueprintControls from './BlueprintControls';
import { generateUniqueId } from '@/lib/utils';
import { toast } from 'sonner';

interface BlueprintProps {
  selectedTool: string;
  showGrid: boolean;
  showLabels: boolean;
  showEdges: boolean;
  elements: any[];
  connections: any[];
  currentFloor: string;
  onElementSelect: (element: any) => void;
  onAddElement: (element: any) => void;
  onAddConnection: (connection: any) => void;
}

const Blueprint = ({
  selectedTool,
  showGrid,
  showLabels,
  showEdges,
  elements,
  connections,
  currentFloor,
  onElementSelect,
  onAddElement,
  onAddConnection
}: BlueprintProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [drawing, setDrawing] = useState(false);
  const [startPoint, setStartPoint] = useState({ x: 0, y: 0 });
  const [currentPoint, setCurrentPoint] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [connectingElements, setConnectingElements] = useState(false);
  const [sourceElement, setSourceElement] = useState<any>(null);
  const [connectionPoints, setConnectionPoints] = useState<{x: number, y: number}[]>([]);
  const [isMultiPointConnecting, setIsMultiPointConnecting] = useState(false);
  const [customPois, setCustomPois] = useState<string[]>([]);

  const handleZoom = (delta: number) => {
    const newScale = Math.max(0.1, Math.min(5, scale + delta * 0.1));
    setScale(newScale);
  };

  const findElementAtPosition = (x: number, y: number) => {
    return elements.find(element => {
      if (element.type === 'poi') {
        const centerX = element.x;
        const centerY = element.y;
        const radius = element.width / 2;
        return Math.sqrt(Math.pow(x - centerX, 2) + Math.pow(y - centerY, 2)) <= radius;
      } else {
        return (
          x >= element.x &&
          x <= element.x + element.width &&
          y >= element.y &&
          y <= element.y + element.height
        );
      }
    });
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left - position.x) / scale;
    const y = (e.clientY - rect.top - position.y) / scale;

    if (selectedTool === 'pan') {
      setIsPanning(true);
      setPanStart({ x: e.clientX, y: e.clientY });
      return;
    }

    // Handle element selection and connection start
    if (selectedTool === 'select' || selectedTool.startsWith('connect-')) {
      const clickedElement = findElementAtPosition(x, y);

      if (clickedElement) {
        // Connection mode
        if (selectedTool.startsWith('connect-')) {
          // Multi-point mode
          if (selectedTool === 'connect-multi') {
            if (!isMultiPointConnecting) {
              // Start multi-point connecting
              setIsMultiPointConnecting(true);
              setSourceElement(clickedElement);
              setConnectionPoints([]);
              const startPos = { 
                x: clickedElement.x + clickedElement.width / 2, 
                y: clickedElement.y + clickedElement.height / 2 
              };
              setConnectionPoints([startPos]);
              setStartPoint(startPos);
              setCurrentPoint(startPos);
              setDrawing(true);
            }
            return;
          } 
          
          // Standard connecting
          setConnectingElements(true);
          setSourceElement(clickedElement);
          setStartPoint({ 
            x: clickedElement.x + clickedElement.width / 2, 
            y: clickedElement.y + clickedElement.height / 2 
          });
          setCurrentPoint({ 
            x: clickedElement.x + clickedElement.width / 2, 
            y: clickedElement.y + clickedElement.height / 2 
          });
          setDrawing(true);
          return;
        }

        // Selection mode
        onElementSelect(clickedElement);
        return;
      } else if (isMultiPointConnecting) {
        // Add a bend point to multi-point connection
        setConnectionPoints([...connectionPoints, { x, y }]);
        return;
      }
    }

    // Start drawing
    if (['room', 'hallway', 'custom', 'entry', 'stairs'].includes(selectedTool)) {
      setDrawing(true);
      setStartPoint({ x, y });
      setCurrentPoint({ x, y });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left - position.x) / scale;
    const y = (e.clientY - rect.top - position.y) / scale;

    // Handle panning
    if (isPanning) {
      setPosition({
        x: position.x + (e.clientX - panStart.x),
        y: position.y + (e.clientY - panStart.y),
      });
      setPanStart({ x: e.clientX, y: e.clientY });
      return;
    }

    // Handle drawing or connecting
    if (drawing) {
      setCurrentPoint({ x, y });
    }
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left - position.x) / scale;
    const y = (e.clientY - rect.top - position.y) / scale;

    // Handle panning
    if (isPanning) {
      setIsPanning(false);
      return;
    }

    // Finish drawing or connecting
    if (drawing && !isMultiPointConnecting) {
      setDrawing(false);

      // Handle connecting elements
      if (connectingElements && sourceElement) {
        const targetElement = findElementAtPosition(x, y);
        
        if (targetElement && targetElement.id !== sourceElement.id) {
          // Create a connection
          const connectionType = selectedTool.replace('connect-', '');
          let points = [];
          
          if (connectionType === 'bent') {
            // For bent connections, add a midpoint
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
          }
          
          const connection = {
            id: generateUniqueId(),
            source: sourceElement.id,
            target: targetElement.id,
            type: connectionType,
            floor: currentFloor,
            directed: true,
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
        }
        
        setConnectingElements(false);
        setSourceElement(null);
        return;
      }

      // Create new element
      if (['room', 'hallway', 'custom', 'entry', 'stairs'].includes(selectedTool)) {
        const width = Math.abs(currentPoint.x - startPoint.x);
        const height = Math.abs(currentPoint.y - startPoint.y);
        
        // Only add if it has some size
        if (width > 5 && height > 5) {
          const element = {
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
          
          onAddElement(element);
          toast.success(`Added new ${selectedTool}`);
        }
      }
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    // Complete multi-point connection on Enter
    if (e.key === 'Enter' && isMultiPointConnecting && sourceElement && connectionPoints.length > 1) {
      const lastPoint = connectionPoints[connectionPoints.length - 1];
      const targetElement = findElementAtPosition(lastPoint.x, lastPoint.y);

      if (targetElement && targetElement.id !== sourceElement.id) {
        // Create a connection with multiple points
        const connection = {
          id: generateUniqueId(),
          source: sourceElement.id,
          target: targetElement.id,
          type: 'multi',
          floor: currentFloor,
          directed: true,
          label: '',
          distance: 0,
          travel_time: 0,
          points: connectionPoints,
          width: 1,
          capacity: 1,
          wheelchair_accessible: true,
          allow_vehicles: false,
          custom_attributes: []
        };
        
        onAddConnection(connection);
        toast.success('Created multi-point connection');
      }
      
      // Reset connection state
      setIsMultiPointConnecting(false);
      setConnectingElements(false);
      setSourceElement(null);
      setConnectionPoints([]);
      setDrawing(false);
      e.preventDefault();
    }
    
    // Cancel multi-point connection on Escape
    if (e.key === 'Escape' && isMultiPointConnecting) {
      setIsMultiPointConnecting(false);
      setConnectingElements(false);
      setSourceElement(null);
      setConnectionPoints([]);
      setDrawing(false);
      e.preventDefault();
    }

    // Handle keyboard shortcuts
    if (e.ctrlKey || e.metaKey) {
      if (e.key === 'z') {
        // Undo
        e.preventDefault();
      } else if (e.key === 'y') {
        // Redo
        e.preventDefault();
      }
    }
  };

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isMultiPointConnecting, sourceElement, connectionPoints]);

  // Handle POI placement
  const handleCanvasClick = (e: React.MouseEvent) => {
    if (!containerRef.current) return;
    
    const rect = containerRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left - position.x) / scale;
    const y = (e.clientY - rect.top - position.y) / scale;

    if (selectedTool.startsWith('poi-')) {
      const poiType = selectedTool.split('-')[1];
      const element = {
        id: generateUniqueId(),
        type: 'poi',
        poiType,
        x,
        y,
        width: 24,
        height: 24,
        name: `${poiType.charAt(0).toUpperCase() + poiType.slice(1)}`,
        floor: currentFloor,
        tags: [poiType],
        custom_attributes: [],
        capacity: 0
      };
      
      onAddElement(element);
      toast.success(`Added new POI: ${poiType}`);
    }
  };

  // Add a custom POI type
  const handleAddCustomPoi = (poiName: string) => {
    const poiId = poiName.toLowerCase().replace(/\s+/g, '-');
    if (!customPois.includes(poiId)) {
      setCustomPois([...customPois, poiId]);
      toast.success(`Added new POI type: ${poiName}`);
    }
  };

  return (
    <div 
      ref={containerRef}
      className="relative w-full h-full overflow-hidden cursor-crosshair"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onClick={handleCanvasClick}
    >
      <BlueprintCanvas
        scale={scale}
        position={position}
        showGrid={showGrid}
        showLabels={showLabels}
        showEdges={showEdges}
        elements={elements}
        connections={connections}
        currentFloor={currentFloor}
        drawing={drawing}
        startPoint={startPoint}
        currentPoint={currentPoint}
        selectedTool={selectedTool}
        connectingElements={connectingElements}
        connectionPoints={connectionPoints}
        isMultiPointConnecting={isMultiPointConnecting}
      />
      <BlueprintControls
        scale={scale}
        onZoom={handleZoom}
        position={position}
        setPosition={setPosition}
      />
      {isMultiPointConnecting && (
        <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 bg-white p-2 rounded shadow-md text-xs">
          Click to add bend points. Press Enter to complete the connection or Esc to cancel.
        </div>
      )}
    </div>
  );
};

export default Blueprint;
