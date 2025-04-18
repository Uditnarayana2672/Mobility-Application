
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
import { Slider } from "@/components/ui/slider"; 
import { Compass } from "lucide-react";

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
  const [trueNorthDialogOpen, setTrueNorthDialogOpen] = useState(false);
  const [trueNorth, setTrueNorth] = useState(0);
  
  // New states for element manipulation
  const [isMovingElement, setIsMovingElement] = useState(false);
  const [movingElement, setMovingElement] = useState<any>(null);
  const [elementOffset, setElementOffset] = useState({ x: 0, y: 0 });
  const [isResizingElement, setIsResizingElement] = useState(false);
  const [resizeDirection, setResizeDirection] = useState('');
  const [isDrawingWall, setIsDrawingWall] = useState(false);
  const [wallPoints, setWallPoints] = useState<{x: number, y: number}[]>([]);

  const handleZoom = (delta: number) => {
    const newScale = Math.max(0.1, Math.min(5, scale + delta * 0.1));
    setScale(newScale);
  };

  const findElementAtPosition = (x: number, y: number) => {
    // Sort elements by size (smallest first) to prioritize selection of smaller elements
    const sortedElements = [...elements].sort((a, b) => {
      const areaA = a.width * a.height;
      const areaB = b.width * b.height;
      return areaA - areaB;
    });
    
    return sortedElements.find(element => {
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

  // Check if point is near element edge or corner for resizing
  const getResizeHandleAtPosition = (x: number, y: number, element: any) => {
    const handleSize = 10 / scale; // Adjust handle size based on zoom
    const edges = {
      'nw': { x: element.x, y: element.y },
      'n': { x: element.x + element.width / 2, y: element.y },
      'ne': { x: element.x + element.width, y: element.y },
      'e': { x: element.x + element.width, y: element.y + element.height / 2 },
      'se': { x: element.x + element.width, y: element.y + element.height },
      's': { x: element.x + element.width / 2, y: element.y + element.height },
      'sw': { x: element.x, y: element.y + element.height },
      'w': { x: element.x, y: element.y + element.height / 2 }
    };

    for (const [direction, point] of Object.entries(edges)) {
      if (Math.abs(x - point.x) <= handleSize && Math.abs(y - point.y) <= handleSize) {
        return direction;
      }
    }
    
    return null;
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left - position.x) / scale;
    const y = (e.clientY - rect.top - position.y) / scale;

    // True North tool handling
    if (selectedTool === 'true-north') {
      setTrueNorthDialogOpen(true);
      return;
    }
    
    // Wall drawing tool
    if (selectedTool === 'wall-draw') {
      if (!isDrawingWall) {
        setIsDrawingWall(true);
        setWallPoints([{ x, y }]);
      } else {
        // Add point to wall
        setWallPoints([...wallPoints, { x, y }]);
      }
      return;
    }

    if (selectedTool === 'pan') {
      setIsPanning(true);
      setPanStart({ x: e.clientX, y: e.clientY });
      return;
    }

    if (selectedTool === 'select') {
      const clickedElement = findElementAtPosition(x, y);
      
      if (clickedElement) {
        // Check if clicking on a resize handle
        const resizeHandle = getResizeHandleAtPosition(x, y, clickedElement);
        
        if (resizeHandle) {
          setIsResizingElement(true);
          setResizeDirection(resizeHandle);
          setMovingElement(clickedElement);
          onElementSelect(clickedElement);
          return;
        }
        
        // If not on resize handle, start moving the element
        setIsMovingElement(true);
        setMovingElement(clickedElement);
        setElementOffset({ 
          x: x - clickedElement.x, 
          y: y - clickedElement.y 
        });
        onElementSelect(clickedElement);
        return;
      }
    }

    if (selectedTool.startsWith('connect-')) {
      const clickedElement = findElementAtPosition(x, y);

      if (clickedElement) {
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
      } else if (isMultiPointConnecting) {
        setConnectionPoints([...connectionPoints, { x, y }]);
        return;
      }
    }

    if (['room', 'hallway', 'custom', 'entry', 'stairs', 'wall'].includes(selectedTool)) {
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

    // Update cursor based on what's under it
    if (selectedTool === 'select') {
      const clickedElement = findElementAtPosition(x, y);
      if (clickedElement) {
        const resizeHandle = getResizeHandleAtPosition(x, y, clickedElement);
        if (resizeHandle) {
          // Set cursor based on resize direction
          switch (resizeHandle) {
            case 'nw': case 'se': containerRef.current.style.cursor = 'nwse-resize'; break;
            case 'ne': case 'sw': containerRef.current.style.cursor = 'nesw-resize'; break;
            case 'n': case 's': containerRef.current.style.cursor = 'ns-resize'; break;
            case 'e': case 'w': containerRef.current.style.cursor = 'ew-resize'; break;
            default: containerRef.current.style.cursor = 'move';
          }
        } else {
          containerRef.current.style.cursor = 'move';
        }
      } else {
        containerRef.current.style.cursor = 'default';
      }
    }

    if (isPanning) {
      setPosition({
        x: position.x + (e.clientX - panStart.x),
        y: position.y + (e.clientY - panStart.y),
      });
      setPanStart({ x: e.clientX, y: e.clientY });
      return;
    }
    
    // Handle element moving
    if (isMovingElement && movingElement && onElementUpdate) {
      const newX = x - elementOffset.x;
      const newY = y - elementOffset.y;
      
      const updatedElement = {
        ...movingElement,
        x: newX,
        y: newY
      };
      
      onElementUpdate(updatedElement);
      setMovingElement(updatedElement);
      return;
    }
    
    // Handle element resizing
    if (isResizingElement && movingElement && resizeDirection && onElementUpdate) {
      let newX = movingElement.x;
      let newY = movingElement.y;
      let newWidth = movingElement.width;
      let newHeight = movingElement.height;
      
      // Update dimensions based on resize direction
      switch (resizeDirection) {
        case 'nw':
          newWidth = movingElement.x + movingElement.width - x;
          newHeight = movingElement.y + movingElement.height - y;
          newX = x;
          newY = y;
          break;
        case 'n':
          newHeight = movingElement.y + movingElement.height - y;
          newY = y;
          break;
        case 'ne':
          newWidth = x - movingElement.x;
          newHeight = movingElement.y + movingElement.height - y;
          newY = y;
          break;
        case 'e':
          newWidth = x - movingElement.x;
          break;
        case 'se':
          newWidth = x - movingElement.x;
          newHeight = y - movingElement.y;
          break;
        case 's':
          newHeight = y - movingElement.y;
          break;
        case 'sw':
          newWidth = movingElement.x + movingElement.width - x;
          newHeight = y - movingElement.y;
          newX = x;
          break;
        case 'w':
          newWidth = movingElement.x + movingElement.width - x;
          newX = x;
          break;
      }
      
      // Ensure minimum size
      if (newWidth < 10) {
        newWidth = 10;
        if (resizeDirection.includes('w')) newX = movingElement.x + movingElement.width - 10;
      }
      
      if (newHeight < 10) {
        newHeight = 10;
        if (resizeDirection.includes('n')) newY = movingElement.y + movingElement.height - 10;
      }
      
      const updatedElement = {
        ...movingElement,
        x: newX,
        y: newY,
        width: newWidth,
        height: newHeight
      };
      
      onElementUpdate(updatedElement);
      setMovingElement(updatedElement);
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
    
    // Reset element moving state
    if (isMovingElement) {
      setIsMovingElement(false);
      setMovingElement(null);
      return;
    }
    
    // Reset element resizing state
    if (isResizingElement) {
      setIsResizingElement(false);
      setMovingElement(null);
      setResizeDirection('');
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

      if (['room', 'hallway', 'custom', 'entry', 'stairs', 'wall'].includes(selectedTool)) {
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
          
          // Add wall-specific properties if it's a wall
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
      }
    }
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    // Finish wall drawing on double-click
    if (isDrawingWall && wallPoints.length > 1) {
      const wallElements = [];
      
      // Convert wall points to wall elements
      for (let i = 0; i < wallPoints.length - 1; i++) {
        const start = wallPoints[i];
        const end = wallPoints[i+1];
        
        // Calculate wall dimensions
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const length = Math.sqrt(dx * dx + dy * dy);
        const angle = Math.atan2(dy, dx);
        
        // Create wall with thickness 1
        const thickness = 2;
        
        // Position the wall at start point
        const wallElement = {
          id: generateUniqueId(),
          type: 'wall',
          x: start.x,
          y: start.y - thickness/2,
          width: length,
          height: thickness,
          name: `Wall segment ${i+1}`,
          floor: currentFloor,
          tags: ['wall'],
          custom_attributes: [],
          rotation: angle * (180 / Math.PI),
          wallThickness: thickness,
          label: 'Wall'
        };
        
        wallElements.push(wallElement);
      }
      
      // Add all wall elements
      wallElements.forEach(wall => onAddElement(wall));
      
      // Reset wall drawing
      setIsDrawingWall(false);
      setWallPoints([]);
      toast.success(`Added ${wallElements.length} wall segments`);
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
    
    if (e.key === 'Escape') {
      // Cancel multi-point connection
      if (isMultiPointConnecting) {
        setIsMultiPointConnecting(false);
        setConnectingElements(false);
        setSourceElement(null);
        setConnectionPoints([]);
        setDrawing(false);
        e.preventDefault();
      }
      
      // Cancel wall drawing
      if (isDrawingWall) {
        setIsDrawingWall(false);
        setWallPoints([]);
        e.preventDefault();
      }
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
  }, [isMultiPointConnecting, sourceElement, connectionPoints, isDrawingWall, wallPoints]);

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

  const saveTrueNorth = () => {
    setTrueNorthDialogOpen(false);
    toast.success(`True north orientation set to ${trueNorth}°`);
  };

  return (
    <div 
      ref={containerRef}
      className="relative w-full h-full overflow-hidden cursor-crosshair"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onClick={handleCanvasClick}
      onDoubleClick={handleDoubleClick}
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
        trueNorth={trueNorth}
        wallPoints={wallPoints}
        isDrawingWall={isDrawingWall}
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
      
      {isDrawingWall && (
        <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 bg-white p-2 rounded shadow-md text-xs">
          Click to add wall points. Double-click to complete the walls or Esc to cancel.
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

      <Dialog open={trueNorthDialogOpen} onOpenChange={setTrueNorthDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Compass className="h-5 w-5" /> Set True North Orientation
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="flex items-center gap-4">
              <Label htmlFor="true-north">Rotation (degrees)</Label>
              <div className="flex-1">
                <Slider
                  id="true-north"
                  min={0}
                  max={359}
                  step={1}
                  value={[trueNorth]}
                  onValueChange={(values) => setTrueNorth(values[0])}
                />
              </div>
              <Input 
                type="number" 
                min={0}
                max={359}
                value={trueNorth} 
                onChange={e => setTrueNorth(parseInt(e.target.value) || 0)} 
                className="w-16"
              />
            </div>
            
            <div className="flex justify-center py-8">
              <div className="relative w-24 h-24">
                <Compass className="w-24 h-24 text-blue-600" style={{ transform: `rotate(${trueNorth}deg)` }} />
                <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 text-blue-600 font-bold">N</div>
              </div>
            </div>

            <p className="text-sm text-muted-foreground">
              Set the angle of true north relative to the top of the plan (0° = North is up)
            </p>
            
            <Button onClick={saveTrueNorth}>Apply Orientation</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Blueprint;
