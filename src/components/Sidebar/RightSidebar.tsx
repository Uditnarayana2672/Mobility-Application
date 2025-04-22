import { useState } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { 
  Card, 
  CardContent, 
  CardHeader, 
  CardTitle, 
  CardDescription,
  CardFooter 
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Pencil, Trash, Move } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface RightSidebarProps {
  selectedElement: any;
  onElementUpdate?: (element: any) => void;
  onDeleteElement?: (elementId: string) => void;
  onDeleteConnection?: (connectionId: string) => void;
}

const RightSidebar = ({ 
  selectedElement, 
  onElementUpdate,
  onDeleteElement,
  onDeleteConnection
}: RightSidebarProps) => {
  const [elementProperties, setElementProperties] = useState<any>({});

  const handlePropertyChange = (property: string, value: any) => {
    if (!selectedElement) return;
    
    const updatedProperties = {
      ...elementProperties,
      [property]: value
    };
    
    setElementProperties(updatedProperties);
    
    if (onElementUpdate) {
      onElementUpdate({
        ...selectedElement,
        ...updatedProperties
      });
    }
  };
  
  const handleTagAdd = (tag: string) => {
    if (!selectedElement || !tag.trim()) return;
    
    const existingTags = selectedElement.tags || [];
    if (!existingTags.includes(tag)) {
      const updatedTags = [...existingTags, tag.trim()];
      handlePropertyChange('tags', updatedTags);
    }
  };
  
  const handleTagRemove = (tagToRemove: string) => {
    if (!selectedElement) return;
    
    const existingTags = selectedElement.tags || [];
    const updatedTags = existingTags.filter((tag: string) => tag !== tagToRemove);
    handlePropertyChange('tags', updatedTags);
  };
  
  const handleDeleteElement = () => {
    if (!selectedElement) return;
    
    if (selectedElement.source && onDeleteConnection) {
      // It's a connection
      onDeleteConnection(selectedElement.id);
    } else if (onDeleteElement) {
      // It's an element
      onDeleteElement(selectedElement.id);
    }
  };

  // Add this new handler for coordinate position
  const handleCoordinatePositionChange = (value: string) => {
    handlePropertyChange('coordinatePosition', value);
  };

  if (!selectedElement) {
    return (
      <div className="w-80 bg-sidebar border-l border-gray-200">
        <div className="p-4 text-center text-gray-500">
          No element selected
        </div>
      </div>
    );
  }

  const isConnection = selectedElement.hasOwnProperty('source') && selectedElement.hasOwnProperty('target');

  return (
    <div className="w-80 bg-sidebar border-l border-gray-200">
      <ScrollArea className="h-full">
        <div className="p-4">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-medium">Properties</h2>
            <div className="flex gap-2">
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" size="icon" className="text-destructive">
                    <Trash className="h-4 w-4" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete {isConnection ? 'Connection' : 'Element'}</AlertDialogTitle>
                    <AlertDialogDescription>
                      Are you sure you want to delete this {isConnection ? 'connection' : 'element'}? This action cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleDeleteElement} className="bg-destructive">
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle>{selectedElement.name || 'Unnamed Element'}</CardTitle>
              <CardDescription>
                Type: {isConnection ? 'Connection' : selectedElement.type}
                {selectedElement.poiType && ` - ${selectedElement.poiType}`}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {!isConnection && (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="element-name">Name</Label>
                      <Input
                        id="element-name"
                        value={selectedElement.name || ''}
                        onChange={e => handlePropertyChange('name', e.target.value)}
                      />
                    </div>
                    
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-2">
                        <Label htmlFor="element-x">X</Label>
                        <Input
                          id="element-x"
                          type="number"
                          value={selectedElement.x || 0}
                          onChange={e => handlePropertyChange('x', Number(e.target.value))}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="element-y">Y</Label>
                        <Input
                          id="element-y"
                          type="number"
                          value={selectedElement.y || 0}
                          onChange={e => handlePropertyChange('y', Number(e.target.value))}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="element-width">Width</Label>
                        <Input
                          id="element-width"
                          type="number"
                          value={selectedElement.width || 0}
                          onChange={e => handlePropertyChange('width', Number(e.target.value))}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="element-height">Height</Label>
                        <Input
                          id="element-height"
                          type="number"
                          value={selectedElement.height || 0}
                          onChange={e => handlePropertyChange('height', Number(e.target.value))}
                        />
                      </div>
                    </div>
                    
                    {(selectedElement.type === 'entry' || selectedElement.type === 'room' || selectedElement.type === 'hallway') && (
                      <div className="space-y-2">
                        <Label htmlFor="element-imageUrl">Image URL</Label>
                        <Input
                          id="element-imageUrl"
                          value={selectedElement.imageUrl || ''}
                          onChange={e => handlePropertyChange('imageUrl', e.target.value)}
                          placeholder="Enter image URL"
                        />
                      </div>
                    )}

                    {selectedElement.type === 'wall' && (
                      <>
                        <div className="space-y-2">
                          <Label htmlFor="wall-thickness">Wall Thickness (m)</Label>
                          <Input
                            id="wall-thickness"
                            type="number"
                            value={selectedElement.wallThickness || 1}
                            onChange={e => handlePropertyChange('wallThickness', Number(e.target.value))}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Wall Material</Label>
                          <Select
                            value={selectedElement.material || 'concrete'}
                            onValueChange={value => handlePropertyChange('material', value)}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Select material" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="concrete">Concrete</SelectItem>
                              <SelectItem value="brick">Brick</SelectItem>
                              <SelectItem value="glass">Glass</SelectItem>
                              <SelectItem value="wood">Wood</SelectItem>
                              <SelectItem value="metal">Metal</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </>
                    )}

                    {selectedElement.type === 'stairs' && (
                      <div className="space-y-2">
                        <Label>Stairs Type</Label>
                        <Select
                          value={selectedElement.stairsType || 'normal'}
                          onValueChange={value => handlePropertyChange('stairsType', value)}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select stairs type" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="normal">Normal</SelectItem>
                            <SelectItem value="spiral">Spiral</SelectItem>
                            <SelectItem value="escalator">Escalator</SelectItem>
                            <SelectItem value="elevator">Elevator</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    )}

                    <div className="space-y-2">
                      <Label htmlFor="element-capacity">Capacity</Label>
                      <Input
                        id="element-capacity"
                        type="number"
                        value={selectedElement.capacity || 0}
                        onChange={e => handlePropertyChange('capacity', Number(e.target.value))}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="element-dimension">Dimension Unit</Label>
                      <Select
                        value={selectedElement.dimension || 'm'}
                        onValueChange={value => handlePropertyChange('dimension', value)}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select dimension unit" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="m">Meters</SelectItem>
                          <SelectItem value="ft">Feet</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="element-lat">Latitude</Label>
                        <Input
                          id="element-lat"
                          type="text"
                          value={selectedElement.latitude || ''}
                          onChange={e => handlePropertyChange('latitude', Number(e.target.value))}
                          placeholder="Optional"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="element-lng">Longitude</Label>
                        <Input
                          id="element-lng"
                          type="text"
                          value={selectedElement.longitude || ''}
                          onChange={e => handlePropertyChange('longitude', Number(e.target.value))}
                          placeholder="Optional"
                        />
                      </div>
                    </div>

                    {(selectedElement.latitude || selectedElement.longitude) && (
                      <div className="space-y-2">
                        <Label>Coordinate Position</Label>
                        <Select
                          value={selectedElement.coordinatePosition || 'center'}
                          onValueChange={handleCoordinatePositionChange}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select position" />
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
                    )}
                  </>
                )}
                
                {isConnection && (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="connection-label">Label</Label>
                      <Input
                        id="connection-label"
                        value={selectedElement.label || ''}
                        onChange={e => handlePropertyChange('label', e.target.value)}
                      />
                    </div>
                    
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-2">
                        <Label htmlFor="connection-distance">Distance (m)</Label>
                        <Input
                          id="connection-distance"
                          type="number"
                          value={selectedElement.distance || 0}
                          onChange={e => handlePropertyChange('distance', Number(e.target.value))}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="connection-time">Travel Time (s)</Label>
                        <Input
                          id="connection-time"
                          type="number"
                          value={selectedElement.travel_time || 0}
                          onChange={e => handlePropertyChange('travel_time', Number(e.target.value))}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="connection-width">Width (m)</Label>
                        <Input
                          id="connection-width"
                          type="number"
                          value={selectedElement.width || 1}
                          onChange={e => handlePropertyChange('width', Number(e.target.value))}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="connection-capacity">Capacity</Label>
                        <Input
                          id="connection-capacity"
                          type="number"
                          value={selectedElement.capacity || 1}
                          onChange={e => handlePropertyChange('capacity', Number(e.target.value))}
                        />
                      </div>
                    </div>
                    
                    <div className="space-y-2">
                      <Label>Connection Type</Label>
                      <Select
                        value={selectedElement.type || 'straight'}
                        onValueChange={value => handlePropertyChange('type', value)}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select connection type" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="straight">Straight Line</SelectItem>
                          <SelectItem value="bent">Multi-Point (Bent)</SelectItem>
                          <SelectItem value="path">Bidirectional Path</SelectItem>
                          <SelectItem value="multi">Multi-Point Path</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="flex items-center space-x-2">
                        <Switch
                          id="connection-directed"
                          checked={!!selectedElement.directed}
                          onCheckedChange={checked => handlePropertyChange('directed', checked)}
                        />
                        <Label htmlFor="connection-directed">Directed</Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Switch
                          id="connection-bidirectional"
                          checked={!!selectedElement.bidirectional}
                          onCheckedChange={checked => handlePropertyChange('bidirectional', checked)}
                        />
                        <Label htmlFor="connection-bidirectional">Bidirectional</Label>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="flex items-center space-x-2">
                        <Switch
                          id="connection-wheelchair"
                          checked={selectedElement.wheelchair_accessible !== false}
                          onCheckedChange={checked => handlePropertyChange('wheelchair_accessible', checked)}
                        />
                        <Label htmlFor="connection-wheelchair">Wheelchair Accessible</Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Switch
                          id="connection-vehicles"
                          checked={!!selectedElement.allow_vehicles}
                          onCheckedChange={checked => handlePropertyChange('allow_vehicles', checked)}
                        />
                        <Label htmlFor="connection-vehicles">Allow Vehicles</Label>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="connection-path-type">Path Type</Label>
                      <Select
                        value={selectedElement.pathType || 'walkway'}
                        onValueChange={value => handlePropertyChange('pathType', value)}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select path type" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="walkway">Walkway</SelectItem>
                          <SelectItem value="corridor">Corridor</SelectItem>
                          <SelectItem value="road">Road</SelectItem>
                          <SelectItem value="bridge">Bridge</SelectItem>
                          <SelectItem value="tunnel">Tunnel</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {selectedElement.type === 'path' && (
                      <div className="space-y-2">
                        <Label htmlFor="path-weight">Path Weight</Label>
                        <Input
                          id="path-weight"
                          type="number"
                          value={selectedElement.weight || 1}
                          onChange={e => handlePropertyChange('weight', Number(e.target.value))}
                          min="1"
                        />
                      </div>
                    )}
                  </>
                )}
                
                <Separator />
                
                <div className="space-y-2">
                  <Label htmlFor="element-tags">Tags</Label>
                  <div className="flex flex-wrap gap-2 mb-2">
                    {(selectedElement.tags || []).map((tag: string, index: number) => (
                      <Badge key={index} variant="outline" className="flex items-center gap-1">
                        {tag}
                        <button
                          onClick={() => handleTagRemove(tag)}
                          className="text-gray-500 hover:text-gray-700 ml-1"
                        >
                          ×
                        </button>
                      </Badge>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <Input
                      id="element-tags"
                      placeholder="Add tag"
                      onKeyPress={(e) => {
                        if (e.key === 'Enter') {
                          handleTagAdd((e.target as HTMLInputElement).value);
                          (e.target as HTMLInputElement).value = '';
                        }
                      }}
                    />
                    <Button
                      variant="outline"
                      onClick={() => {
                        const input = document.getElementById('element-tags') as HTMLInputElement;
                        handleTagAdd(input.value);
                        input.value = '';
                      }}
                    >
                      Add
                    </Button>
                  </div>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="element-notes">Notes</Label>
                  <Textarea
                    id="element-notes"
                    value={selectedElement.notes || ''}
                    onChange={e => handlePropertyChange('notes', e.target.value)}
                    rows={4}
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </ScrollArea>
    </div>
  );
};

export default RightSidebar;
