import { useRef, useState, useEffect } from 'react';
import BlueprintCanvas from './BlueprintCanvas';
import BlueprintControls from './BlueprintControls';
import { generateUniqueId, findElementAtPosition } from '@/lib/utils';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider"; 
import { Compass } from "lucide-react";
import { useDrawing } from '@/hooks/useDrawing';
import { useConnections } from '@/hooks/useConnections';
import { useOrigin } from '@/hooks/useOrigin';
import { useElementDragging } from '@/hooks/useElementDragging';

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
  onDeleteElement?: (elementId: string) => void;
  onDeleteConnection?: (connectionId: string) => void;
  onMoveElement?: (elementId: string, deltaX: number, deltaY: number) => void;
}

const Blueprint: React.FC<BlueprintProps> = ({
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
  onElementUpdate,
  onDeleteElement,
  onDeleteConnection,
  onMoveElement
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [trueNorth, setTrueNorth] = useState(0);
  const [trueNorthDialogOpen, setTrueNorthDialogOpen] = useState(false);
  const [selectedCoordinatesElement, setSelectedCoordinatesElement] = useState<any>(null);
  const [coordinatesDialogOpen, setCoordinatesDialogOpen] = useState(false);
  const [coordinates, setCoordinates] = useState({ latitude: '', longitude: '', position: 'center' });

  const { drawing, startPoint, currentPoint, startDrawing, updateDrawing, finishDrawing } = useDrawing(currentFloor, onAddElement);
  const { connectingElements, sourceElement, connectionPoints, isMultiPointConnecting, startConnection, addConnectionPoint, finishConnection, resetConnection } = useConnections(currentFloor, onAddConnection);
  const { originPoint, originSet, setOrigin } = useOrigin();
  const { isDragging, draggedElement, startDragging, updateDragging, stopDragging } = useElementDragging(onMoveElement);

  const handleZoom = (delta: number) => {
    const newScale = Math.max(0.1, Math.min(5, scale + delta * 0.1));
    setScale(newScale);
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left - position.x) / scale;
    const y = (e.clientY - rect.top - position.y) / scale;

    // Set origin point if Ctrl/Cmd key is pressed
    if ((e.ctrlKey || e.metaKey) && selectedTool === 'select') {
      setOrigin(x, y);
      return;
    }

    if (selectedTool === 'pan') {
      setIsPanning(true);
      setPanStart({ x: e.clientX, y: e.clientY });
      return;
    }

    if (selectedTool === 'true-north') {
      setTrueNorthDialogOpen(true);
      return;
    }

    if (selectedTool === 'select' || selectedTool.startsWith('connect-')) {
      const clickedElement = findElementAtPosition(elements, x, y);

      if (clickedElement) {
        if (selectedTool === 'select') {
          startDragging(clickedElement, x, y);
        }
        
        if (selectedTool.startsWith('connect-')) {
          if (selectedTool === 'connect-multi') {
            if (!isMultiPointConnecting) {
              startConnection(clickedElement, x, y, true);
            }
            return;
          } 
          
          startConnection(clickedElement, x, y);
          return;
        }

        onElementSelect(clickedElement);
        return;
      } else if (isMultiPointConnecting) {
        addConnectionPoint(x, y);
        return;
      }
    }

    if (['room', 'hallway', 'custom', 'entry', 'stairs', 'wall'].includes(selectedTool)) {
      startDrawing(x, y);
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

    if (isDragging && draggedElement && onMoveElement) {
      updateDragging(x, y);
      return;
    }

    if (drawing) {
      updateDrawing(x, y);
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

    if (isDragging) {
      stopDragging();
      return;
    }

    if (drawing && !isMultiPointConnecting) {
      finishDrawing(selectedTool);

      if (connectingElements && sourceElement) {
        const targetElement = findElementAtPosition(elements, x, y);
        
        if (targetElement && targetElement.id !== sourceElement.id) {
          const connectionType = selectedTool.replace('connect-', '');
          finishConnection(targetElement, connectionType);
        }
        
        resetConnection();
        return;
      }
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && isMultiPointConnecting && sourceElement && connectionPoints.length > 1) {
      const lastPoint = connectionPoints[connectionPoints.length - 1];
      const targetElement = findElementAtPosition(elements, lastPoint.x, lastPoint.y);

      if (targetElement && targetElement.id !== sourceElement.id) {
        finishConnection(targetElement, 'multi');
      } else {
        toast.error('No target element found for connection');
      }
      
      resetConnection();
      e.preventDefault();
    }
    
    if (e.key === 'Escape' && isMultiPointConnecting) {
      resetConnection();
      e.preventDefault();
    }

    if (e.key === 'Delete') {
      const selectedElementInCanvas = draggedElement;
      if (selectedElementInCanvas) {
        if (selectedElementInCanvas.source) {
          // It's a connection
          if (onDeleteConnection) {
            onDeleteConnection(selectedElementInCanvas.id);
          }
        } else {
          // It's an element
          if (onDeleteElement) {
            onDeleteElement(selectedElementInCanvas.id);
          }
        }
        e.preventDefault();
      }
    }
  };

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isMultiPointConnecting, sourceElement, connectionPoints, draggedElement]);

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
      const clickedElement = findElementAtPosition(elements, x, y);
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
        originPoint={originPoint}
        originSet={originSet}
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
