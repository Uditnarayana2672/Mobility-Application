import { useRef, useState, useEffect } from 'react';
import BlueprintCanvas from './BlueprintCanvas';
import BlueprintControls from './BlueprintControls';
import { generateUniqueId } from '@/lib/utils';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

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
  onElementUpdate?: (element: any) => void;
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
  onAddConnection,
  onElementUpdate
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
  const [selectedCoordinatesElement, setSelectedCoordinatesElement] = useState<any>(null);
  const [coordinatesDialogOpen, setCoordinatesDialogOpen] = useState(false);
  const [coordinates, setCoordinates] = useState({ latitude: '', longitude: '', position: 'center' });

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

    if (selectedTool === 'select' || selectedTool.startsWith('connect-')) {
      const clickedElement = findElementAtPosition(x, y);

      if (clickedElement) {
        if (selectedTool.startsWith('connect-')) {
          if (selectedTool === 'connect-multi') {
            if (!isMultiPointConnecting) {
              setIsMultiPointConnecting(true);
              setSourceElement(clickedElement);
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

        onElementSelect(clickedElement);
        return;
      } else if (isMultiPointConnecting) {
        setConnectionPoints([...connectionPoints, { x, y }]);
        return;
      }
    }

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

    if (isPanning) {
      setPosition({
        x: position.x + (e.clientX - panStart.x),
        y: position.y + (e.clientY - panStart.y),
      });
      setPanStart({ x: e.clientX, y: e.clientY });
      return;
    }

    if (drawing) {
      setCurrentPoint({ x, y });
    }
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left - position.x) / scale;
    const y = (e.clientY - rect.top - position.y) / scale;

    if (isPanning) {
      setIsPanning(false);
      return;
    }

    if (drawing && !isMultiPointConnecting) {
      setDrawing(false);

      if (connectingElements && sourceElement) {
        const targetElement = findElementAtPosition(x, y);
        
        if (targetElement && targetElement.id !== sourceElement.id) {
          const connectionType = selectedTool.replace('connect-', '');
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

      if (['room', 'hallway', 'custom', 'entry', 'stairs'].includes(selectedTool)) {
        const width = Math.abs(currentPoint.x - startPoint.x);
        const height = Math.abs(currentPoint.y - startPoint.y);
        
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
    if (e.key === 'Enter' && isMultiPointConnecting && sourceElement && connectionPoints.length > 1) {
      const lastPoint = connectionPoints[connectionPoints.length - 1];
      const targetElement = findElementAtPosition(lastPoint.x, lastPoint.y);

      if (targetElement && targetElement.id !== sourceElement.id) {
        const finalPoints = [...connectionPoints, {
          x: targetElement.x + targetElement.width / 2,
          y: targetElement.y + targetElement.height / 2
        }];

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
          points: finalPoints,
          width: 1,
          capacity: 1,
          wheelchair_accessible: true,
          allow_vehicles: false,
          custom_attributes: []
        };
        
        onAddConnection(connection);
        toast.success('Created multi-point connection');
      } else {
        toast.error('No target element found for connection');
      }
      
      setIsMultiPointConnecting(false);
      setConnectingElements(false);
      setSourceElement(null);
      setConnectionPoints([]);
      setDrawing(false);
      e.preventDefault();
    }
    
    if (e.key === 'Escape' && isMultiPointConnecting) {
      setIsMultiPointConnecting(false);
      setConnectingElements(false);
      setSourceElement(null);
      setConnectionPoints([]);
      setDrawing(false);
      e.preventDefault();
    }

    if (e.ctrlKey || e.metaKey) {
      if (e.key === 'z') {
        e.preventDefault();
      } else if (e.key === 'y') {
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
    } else if (selectedTool === 'coordinates') {
      const clickedElement = findElementAtPosition(x, y);
      if (clickedElement) {
        setSelectedCoordinatesElement(clickedElement);
        setCoordinates({
          latitude: clickedElement.latitude || '',
          longitude: clickedElement.longitude || '',
          position: clickedElement.coordinatePosition || 'center'
        });
        setCoordinatesDialogOpen(true);
      }
    }
  };

  const handleAddCustomPoi = (poiName: string) => {
    const poiId = poiName.toLowerCase().replace(/\s+/g, '-');
    if (!customPois.includes(poiId)) {
      setCustomPois([...customPois, poiId]);
      toast.success(`Added new POI type: ${poiName}`);
    }
  };

  const saveCoordinates = () => {
    if (selectedCoordinatesElement && onElementUpdate) {
      const updatedElement = {
        ...selectedCoordinatesElement,
        latitude: parseFloat(coordinates.latitude),
        longitude: parseFloat(coordinates.longitude),
        coordinatePosition: coordinates.position
      };
      
      onElementUpdate(updatedElement);
      setCoordinatesDialogOpen(false);
      toast.success('Coordinates saved');
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

      <Dialog open={coordinatesDialogOpen} onOpenChange={setCoordinatesDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Set Coordinates</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="latitude">Latitude</Label>
              <Input 
                id="latitude" 
                type="number" 
                step="0.000001" 
                value={coordinates.latitude} 
                onChange={e => setCoordinates({...coordinates, latitude: e.target.value})} 
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="longitude">Longitude</Label>
              <Input 
                id="longitude" 
                type="number" 
                step="0.000001" 
                value={coordinates.longitude} 
                onChange={e => setCoordinates({...coordinates, longitude: e.target.value})} 
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="position">Position</Label>
              <Select 
                value={coordinates.position} 
                onValueChange={value => setCoordinates({...coordinates, position: value})}
              >
                <SelectTrigger id="position">
                  <SelectValue placeholder="Position" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="center">Center</SelectItem>
                  <SelectItem value="top-left">Top Left</SelectItem>
                  <SelectItem value="top-right">Top Right</SelectItem>
                  <SelectItem value="bottom-left">Bottom Left</SelectItem>
                  <SelectItem value="bottom-right">Bottom Right</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button onClick={saveCoordinates}>Save Coordinates</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Blueprint;
