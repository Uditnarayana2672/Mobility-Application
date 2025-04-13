
import { useState } from 'react';
import { 
  Input 
} from '@/components/ui/input';
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
import { Plus, X } from 'lucide-react';

interface RightSidebarProps {
  selectedElement: any;
  onElementUpdate: (element: any) => void;
}

const RightSidebar = ({ selectedElement, onElementUpdate }: RightSidebarProps) => {
  const [customAttributes, setCustomAttributes] = useState<{ key: string; value: string }[]>([]);
  
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
    setCustomAttributes([...customAttributes, { key: '', value: '' }]);
  };
  
  const handleRemoveAttribute = (index: number) => {
    const newAttributes = [...customAttributes];
    newAttributes.splice(index, 1);
    setCustomAttributes(newAttributes);
  };
  
  const handleAttributeChange = (index: number, field: 'key' | 'value', value: string) => {
    const newAttributes = [...customAttributes];
    newAttributes[index][field] = value;
    setCustomAttributes(newAttributes);
    
    // Update the selectedElement with new attributes
    handleInputChange('custom_attributes', newAttributes);
  };
  
  return (
    <div className="w-72 bg-sidebar border-l border-gray-200 flex flex-col">
      <div className="p-4">
        <h2 className="font-medium mb-2">Properties</h2>
        <p className="text-sm text-muted-foreground mb-4">
          {selectedElement.type || 'Element'} Properties
        </p>
      </div>
      
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
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
            
            <div className="space-y-2">
              <Label htmlFor="element-coordinates">Coordinates</Label>
              <Input 
                id="element-coordinates" 
                value={selectedElement.coordinates || ''} 
                onChange={(e) => handleInputChange('coordinates', e.target.value)} 
              />
            </div>
          </div>
          
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-2">
              <Label htmlFor="element-width">Width</Label>
              <Input 
                id="element-width" 
                type="number"
                value={selectedElement.width || ''} 
                onChange={(e) => handleInputChange('width', e.target.value)} 
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="element-height">Height</Label>
              <Input 
                id="element-height" 
                type="number"
                value={selectedElement.height || ''} 
                onChange={(e) => handleInputChange('height', e.target.value)} 
              />
            </div>
          </div>
          
          <Separator />
          
          <div className="space-y-2">
            <div className="flex justify-between">
              <Label>Tags</Label>
              <Button variant="ghost" size="sm">
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {(selectedElement.tags || []).map((tag: string, idx: number) => (
                <div 
                  key={idx} 
                  className="bg-muted text-xs px-2 py-1 rounded-md flex items-center"
                >
                  {tag}
                  <Button variant="ghost" size="sm" className="h-4 w-4 ml-1 p-0">
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              ))}
              <Button variant="outline" size="sm" className="text-xs">
                Add Tag
              </Button>
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
          </div>
          
          <Separator />
          
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
          
          <Separator />
          
          <div className="pt-2">
            <Button className="w-full" variant="destructive" size="sm">
              Delete Element
            </Button>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
};

export default RightSidebar;
