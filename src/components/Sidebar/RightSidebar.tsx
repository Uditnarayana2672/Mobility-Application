import { useState, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Plus, X, Upload, Image } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';

interface RightSidebarProps {
  selectedElement: any;
  onElementUpdate: (element: any) => void;
}

const RightSidebar = ({ selectedElement, onElementUpdate }: RightSidebarProps) => {
  const [customAttributes, setCustomAttributes] = useState<{ key: string; value: string }[]>([]);
  const [dimension, setDimension] = useState<string>("m");
  const [imageUrl, setImageUrl] = useState<string>("");

  useEffect(() => {
    if (selectedElement?.custom_attributes) {
      setCustomAttributes(selectedElement.custom_attributes);
    } else {
      setCustomAttributes([]);
    }
    
    if (selectedElement?.imageUrl) {
      setImageUrl(selectedElement.imageUrl);
    } else {
      setImageUrl("");
    }
    
    if (selectedElement?.dimension) {
      setDimension(selectedElement.dimension);
    } else {
      setDimension("m");
    }
  }, [selectedElement]);
  
  if (!selectedElement) {
    return (
      <div className="w-72 bg-sidebar border-l border-gray-200 p-4 flex flex-col">
        <h2 className="font-medium mb-2">Properties</h2>
        <p className="text-sm text-muted-foreground">Select an element to edit its properties</p>
      </div>
    );
  }
  
  const handleInputChange = (field: string, value: any) => {
    onElementUpdate({
      ...selectedElement,
      [field]: value
    });
  };
  
  const handleAddAttribute = () => {
    const newAttributes = [...customAttributes, { key: '', value: '' }];
    setCustomAttributes(newAttributes);
    handleInputChange('custom_attributes', newAttributes);
  };
  
  const handleRemoveAttribute = (index: number) => {
    const newAttributes = [...customAttributes];
    newAttributes.splice(index, 1);
    setCustomAttributes(newAttributes);
    handleInputChange('custom_attributes', newAttributes);
  };
  
  const handleAttributeChange = (index: number, field: 'key' | 'value', value: string) => {
    const newAttributes = [...customAttributes];
    newAttributes[index][field] = value;
    setCustomAttributes(newAttributes);
    
    handleInputChange('custom_attributes', newAttributes);
  };

  const handleAddTag = () => {
    const tags = [...(selectedElement.tags || []), ''];
    handleInputChange('tags', tags);
  };

  const handleRemoveTag = (index: number) => {
    const tags = [...(selectedElement.tags || [])];
    tags.splice(index, 1);
    handleInputChange('tags', tags);
  };

  const handleUpdateTag = (index: number, value: string) => {
    const tags = [...(selectedElement.tags || [])];
    tags[index] = value;
    handleInputChange('tags', tags);
  };
  
  const handleImageUpload = () => {
    const placeholderImages = [
      "https://images.unsplash.com/photo-1649972904349-6e44c42644a7",
      "https://images.unsplash.com/photo-1488590528505-98d2b5aba04b",
      "https://images.unsplash.com/photo-1518770660439-4636190af475",
      "https://images.unsplash.com/photo-1461749280684-dccba630e2f6",
      "https://images.unsplash.com/photo-1486312338219-ce68d2c6f44d"
    ];
    
    const randomImage = placeholderImages[Math.floor(Math.random() * placeholderImages.length)];
    setImageUrl(randomImage);
    handleInputChange('imageUrl', randomImage);
    toast.success("Image uploaded successfully!");
  };
  
  const handleDimensionUnitChange = (unit: string) => {
    setDimension(unit);
    handleInputChange('dimension', unit);
    
    let scaleFactor = 1;
    
    switch (unit) {
      case "cm":
        scaleFactor = 100;
        break;
      case "ft":
        scaleFactor = 3.28084;
        break;
      case "yd":
        scaleFactor = 1.09361;
        break;
      case "km":
        scaleFactor = 0.001;
        break;
      default:
        scaleFactor = 1;
    }
    
    if (selectedElement.width && selectedElement.height) {
      const originalWidth = selectedElement.baseWidth || selectedElement.width;
      const originalHeight = selectedElement.baseHeight || selectedElement.height;
      
      if (!selectedElement.baseWidth) {
        handleInputChange('baseWidth', originalWidth);
        handleInputChange('baseHeight', originalHeight);
      }
      
      handleInputChange('width', originalWidth * scaleFactor);
      handleInputChange('height', originalHeight * scaleFactor);
    }
  };
  
  const renderBasicProperties = () => (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="element-type">Type</Label>
        <Select 
          value={selectedElement.type || ''} 
          onValueChange={(value) => handleInputChange('type', value)}
        >
          <SelectTrigger id="element-type">
            <SelectValue placeholder="Select type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="room">Room</SelectItem>
            <SelectItem value="hallway">Hallway</SelectItem>
            <SelectItem value="poi">POI</SelectItem>
            <SelectItem value="entry">Entry/Exit</SelectItem>
            <SelectItem value="stairs">Stairs/Elevator</SelectItem>
            <SelectItem value="custom">Custom Zone</SelectItem>
          </SelectContent>
        </Select>
      </div>
      
      <div className="space-y-2">
        <Label htmlFor="element-name">Name</Label>
        <Input 
          id="element-name" 
          value={selectedElement.name || ''} 
          onChange={(e) => handleInputChange('name', e.target.value)} 
        />
      </div>
      
      <div className="space-y-2">
        <Label htmlFor="element-description">Description</Label>
        <Textarea 
          id="element-description" 
          value={selectedElement.description || ''} 
          onChange={(e) => handleInputChange('description', e.target.value)} 
          rows={3}
        />
      </div>
      
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-2">
          <Label htmlFor="element-floor">Floor</Label>
          <Input 
            id="element-floor" 
            value={selectedElement.floor || ''} 
            onChange={(e) => handleInputChange('floor', e.target.value)} 
          />
        </div>
        
        {selectedElement.type === 'poi' ? (
          <div className="space-y-2">
            <Label htmlFor="element-poi-type">POI Type</Label>
            <Input 
              id="element-poi-type" 
              value={selectedElement.poiType || ''} 
              onChange={(e) => handleInputChange('poiType', e.target.value)} 
            />
          </div>
        ) : (
          <div className="space-y-2">
            <Label htmlFor="element-coordinates">Coordinates</Label>
            <Input 
              id="element-coordinates" 
              value={selectedElement.coordinates || ''} 
              onChange={(e) => handleInputChange('coordinates', e.target.value)} 
            />
          </div>
        )}
      </div>
      
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-2">
          <Label htmlFor="element-width">Width</Label>
          <div className="flex items-center space-x-2">
            <Input 
              id="element-width" 
              type="number"
              value={selectedElement.width || ''} 
              onChange={(e) => handleInputChange('width', Number(e.target.value))} 
            />
            <Select 
              value={dimension} 
              onValueChange={handleDimensionUnitChange}
            >
              <SelectTrigger className="w-20">
                <SelectValue placeholder="Unit" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="m">m</SelectItem>
                <SelectItem value="cm">cm</SelectItem>
                <SelectItem value="ft">ft</SelectItem>
                <SelectItem value="yd">yd</SelectItem>
                <SelectItem value="km">km</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        
        <div className="space-y-2">
          <Label htmlFor="element-height">Height</Label>
          <Input 
            id="element-height" 
            type="number"
            value={selectedElement.height || ''} 
            onChange={(e) => handleInputChange('height', Number(e.target.value))} 
          />
        </div>
      </div>
      
      <div className="space-y-2 border-t pt-4 mt-4">
        <Label>Geolocation</Label>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-2">
            <Label htmlFor="latitude">Latitude</Label>
            <Input 
              id="latitude" 
              value={selectedElement.latitude || ''} 
              onChange={(e) => handleInputChange('latitude', e.target.value)} 
              placeholder="e.g., 37.7749"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="longitude">Longitude</Label>
            <Input 
              id="longitude" 
              value={selectedElement.longitude || ''} 
              onChange={(e) => handleInputChange('longitude', e.target.value)} 
              placeholder="e.g., -122.4194"
            />
          </div>
        </div>
        
        <div className="flex items-center space-x-2 mt-2">
          <Label htmlFor="coordinate-position" className="flex-shrink-0">Position:</Label>
          <Select 
            value={selectedElement.coordinatePosition || 'center'} 
            onValueChange={(value) => handleInputChange('coordinatePosition', value)}
          >
            <SelectTrigger id="coordinate-position">
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
      </div>
      
      <div className="space-y-2 border-t pt-4">
        <div className="flex justify-between items-center">
          <Label>Element Image</Label>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={handleImageUpload}
          >
            <Image className="h-4 w-4 mr-1" />
            Upload Image
          </Button>
        </div>
        
        {imageUrl && (
          <div className="mt-2 relative">
            <img 
              src={imageUrl} 
              alt="Element" 
              className="w-full h-32 object-cover rounded-md" 
            />
            <Button 
              variant="destructive" 
              size="sm" 
              className="absolute top-1 right-1" 
              onClick={() => {
                setImageUrl("");
                handleInputChange('imageUrl', "");
              }}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );

  const renderConnectionProperties = () => (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="connection-type">Connection Type</Label>
        <Select 
          value={selectedElement.type || ''} 
          onValueChange={(value) => handleInputChange('type', value)}
        >
          <SelectTrigger id="connection-type">
            <SelectValue placeholder="Select type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="straight">Straight</SelectItem>
            <SelectItem value="path">Path</SelectItem>
            <SelectItem value="bent">Bent</SelectItem>
            <SelectItem value="multi">Multi-Point</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="connection-label">Label</Label>
        <Input 
          id="connection-label" 
          value={selectedElement.label || ''} 
          onChange={(e) => handleInputChange('label', e.target.value)} 
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-2">
          <Label htmlFor="connection-distance">Distance (m)</Label>
          <div className="flex items-center space-x-2">
            <Input 
              id="connection-distance" 
              type="number"
              value={selectedElement.distance || 0} 
              onChange={(e) => handleInputChange('distance', Number(e.target.value))} 
            />
            <Select 
              value={dimension} 
              onValueChange={handleDimensionUnitChange}
            >
              <SelectTrigger className="w-20">
                <SelectValue placeholder="Unit" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="m">m</SelectItem>
                <SelectItem value="cm">cm</SelectItem>
                <SelectItem value="ft">ft</SelectItem>
                <SelectItem value="yd">yd</SelectItem>
                <SelectItem value="km">km</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        
        <div className="space-y-2">
          <Label htmlFor="connection-travel-time">Travel Time (s)</Label>
          <Input 
            id="connection-travel-time" 
            type="number"
            value={selectedElement.travel_time || 0} 
            onChange={(e) => handleInputChange('travel_time', Number(e.target.value))} 
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-2">
          <Label htmlFor="connection-width">Width (m)</Label>
          <Input 
            id="connection-width" 
            type="number"
            value={selectedElement.width || 1} 
            onChange={(e) => handleInputChange('width', Number(e.target.value))} 
          />
        </div>
        
        <div className="space-y-2">
          <Label htmlFor="connection-capacity">Capacity</Label>
          <Input 
            id="connection-capacity" 
            type="number"
            value={selectedElement.capacity || 1} 
            onChange={(e) => handleInputChange('capacity', Number(e.target.value))} 
          />
        </div>
      </div>

      <div className="flex items-center justify-between">
        <Label htmlFor="is-directed">Directed Path</Label>
        <Switch
          id="is-directed"
          checked={selectedElement.directed || false}
          onCheckedChange={(checked) => handleInputChange('directed', checked)}
        />
      </div>

      <div className="flex items-center justify-between">
        <Label htmlFor="allow-vehicles">Allow Vehicles</Label>
        <Checkbox
          id="allow-vehicles"
          checked={selectedElement.allow_vehicles || false}
          onCheckedChange={(checked) => handleInputChange('allow_vehicles', checked)}
        />
      </div>

      <div className="flex items-center justify-between">
        <Label htmlFor="wheelchair-accessible">Wheelchair Accessible</Label>
        <Checkbox
          id="wheelchair-accessible"
          checked={selectedElement.wheelchair_accessible || false}
          onCheckedChange={(checked) => handleInputChange('wheelchair_accessible', checked)}
        />
      </div>
    </div>
  );

  const renderTagsAndAttributes = () => (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex justify-between">
          <Label>Tags</Label>
          <Button variant="ghost" size="sm" onClick={handleAddTag}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          {(selectedElement.tags || []).map((tag: string, idx: number) => (
            <div 
              key={idx} 
              className="bg-muted text-xs px-2 py-1 rounded-md flex items-center"
            >
              <Input 
                value={tag} 
                onChange={(e) => handleUpdateTag(idx, e.target.value)} 
                className="border-none bg-transparent h-6 p-0 focus:ring-0 focus:outline-none"
              />
              <Button 
                variant="ghost" 
                size="sm" 
                className="h-4 w-4 ml-1 p-0"
                onClick={() => handleRemoveTag(idx)}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          ))}
          {(selectedElement.tags || []).length === 0 && (
            <Button variant="outline" size="sm" className="text-xs" onClick={handleAddTag}>
              Add Tag
            </Button>
          )}
        </div>
      </div>
      
      <Separator />
      
      <div className="space-y-2">
        <div className="flex justify-between">
          <Label>Custom Attributes</Label>
          <Button variant="ghost" size="sm" onClick={handleAddAttribute}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        
        {customAttributes.map((attr, idx) => (
          <div key={idx} className="flex gap-2 items-start">
            <Input 
              placeholder="Key" 
              value={attr.key} 
              onChange={(e) => handleAttributeChange(idx, 'key', e.target.value)} 
              className="flex-1" 
            />
            <Input 
              placeholder="Value" 
              value={attr.value} 
              onChange={(e) => handleAttributeChange(idx, 'value', e.target.value)} 
              className="flex-1" 
            />
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => handleRemoveAttribute(idx)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ))}

        {customAttributes.length === 0 && (
          <Button variant="outline" size="sm" className="w-full" onClick={handleAddAttribute}>
            Add Attribute
          </Button>
        )}
      </div>
    </div>
  );
  
  return (
    <div className="w-72 bg-sidebar border-l border-gray-200 flex flex-col">
      <div className="p-4">
        <h2 className="font-medium mb-2">Properties</h2>
        <p className="text-sm text-muted-foreground mb-2">
          {selectedElement.type === 'straight' || 
           selectedElement.type === 'path' || 
           selectedElement.type === 'bent' || 
           selectedElement.type === 'multi' 
            ? 'Connection Properties' 
            : (selectedElement.type || 'Element') + ' Properties'}
        </p>
      </div>
      
      <ScrollArea className="flex-1">
        <div className="p-4">
          <Tabs defaultValue="basic" className="w-full">
            <TabsList className="grid grid-cols-3 mb-4">
              <TabsTrigger value="basic">Basic</TabsTrigger>
              {selectedElement.source ? (
                <TabsTrigger value="connection">Connection</TabsTrigger>
              ) : (
                <TabsTrigger value="status">Status</TabsTrigger>
              )}
              <TabsTrigger value="attributes">Attributes</TabsTrigger>
            </TabsList>
            
            <TabsContent value="basic" className="space-y-4">
              {selectedElement.source ? renderConnectionProperties() : renderBasicProperties()}
            </TabsContent>
            
            <TabsContent value="connection" className="space-y-4">
              {renderConnectionProperties()}
            </TabsContent>
            
            <TabsContent value="status" className="space-y-4">
              <div className="flex items-center justify-between">
                <Label htmlFor="landmark-status">Landmark</Label>
                <Switch
                  id="landmark-status"
                  checked={selectedElement.isLandmark || false}
                  onCheckedChange={(checked) => handleInputChange('isLandmark', checked)}
                />
              </div>
              
              <div className="flex items-center justify-between">
                <Label htmlFor="accessibility-status">Accessible</Label>
                <Checkbox
                  id="accessibility-status"
                  checked={selectedElement.isAccessible || false}
                  onCheckedChange={(checked) => handleInputChange('isAccessible', checked)}
                />
              </div>
              
              <div className="flex items-center justify-between">
                <Label htmlFor="capacity">Max Capacity</Label>
                <Input
                  id="capacity"
                  type="number"
                  value={selectedElement.capacity || 0}
                  onChange={(e) => handleInputChange('capacity', Number(e.target.value))}
                  className="w-24"
                />
              </div>
            </TabsContent>
            
            <TabsContent value="attributes" className="space-y-4">
              {renderTagsAndAttributes()}
            </TabsContent>
          </Tabs>
          
          <Separator className="my-4" />
          
          <div className="pt-2">
            <Button className="w-full" variant="destructive" size="sm">
              Delete {selectedElement.source ? 'Connection' : 'Element'}
            </Button>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
};

export default RightSidebar;
