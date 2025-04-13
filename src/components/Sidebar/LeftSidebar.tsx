import { 
  MousePointer, 
  Square, 
  Columns, 
  Printer, 
  DoorClosed, 
  Stars, 
  Box, 
  Hexagon, 
  LineChart, 
  Move, 
  BellRing, 
  Sofa,
  ArrowRight,
  Link,
  Coffee,
  Utensils,
  Droplet,
  Plus,
  ChevronsRight,
  Link2
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { 
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';

interface LeftSidebarProps {
  selectedTool: string;
  onToolSelect: (tool: string) => void;
  onAddCustomPoi?: (name: string) => void;
}

const LeftSidebar = ({ selectedTool, onToolSelect, onAddCustomPoi }: LeftSidebarProps) => {
  const [newPoiName, setNewPoiName] = useState('');
  
  const tools = [
    { id: 'select', icon: MousePointer, label: 'Select' },
    { id: 'draw-polygon', icon: Hexagon, label: 'Polygon' },
    { id: 'draw-line', icon: LineChart, label: 'Line' },
    { id: 'pan', icon: Move, label: 'Pan' },
  ];
  
  const elements = [
    { id: 'room', icon: Square, label: 'Room', color: 'bg-blueprint-element-room' },
    { id: 'hallway', icon: Columns, label: 'Hallway', color: 'bg-blueprint-element-hallway' },
    { id: 'poi', icon: BellRing, label: 'POI', color: 'bg-blueprint-element-poi' },
    { id: 'entry', icon: DoorClosed, label: 'Entry/Exit', color: 'bg-blueprint-element-entry' },
    { id: 'stairs', icon: Stars, label: 'Stairs/Elevator', color: 'bg-blueprint-element-stairs' },
    { id: 'custom', icon: Box, label: 'Custom Zone', color: 'bg-blueprint-element-custom' },
  ];
  
  const pois = [
    { id: 'printer', icon: Printer, label: 'Printer' },
    { id: 'bench', icon: Sofa, label: 'Bench' },
    { id: 'water', icon: Droplet, label: 'Water Cooler' },
    { id: 'coffee', icon: Coffee, label: 'Coffee Machine' },
    { id: 'food', icon: Utensils, label: 'Food Area' },
  ];
  
  const connectors = [
    { id: 'connect-straight', icon: ArrowRight, label: 'Straight Connector' },
    { id: 'connect-path', icon: Link, label: 'Path Connector' },
    { id: 'connect-bent', icon: Link2, label: 'Bent Connector' },
    { id: 'connect-multi', icon: ChevronsRight, label: 'Multi-Point Path' },
  ];

  const handleAddCustomPoi = () => {
    if (newPoiName.trim() && onAddCustomPoi) {
      onAddCustomPoi(newPoiName.trim());
      setNewPoiName('');
    }
  };
  
  return (
    <div className="w-60 bg-sidebar flex flex-col border-r border-gray-200">
      <div className="p-3">
        <h2 className="font-medium text-sm mb-2">Drawing Tools</h2>
        <div className="grid grid-cols-2 gap-2">
          {tools.map((tool) => (
            <Button
              key={tool.id}
              variant={selectedTool === tool.id ? "secondary" : "ghost"}
              size="sm"
              className="justify-start"
              onClick={() => onToolSelect(tool.id)}
            >
              <tool.icon className="h-4 w-4 mr-2" />
              {tool.label}
            </Button>
          ))}
        </div>
      </div>
      
      <Separator />
      
      <ScrollArea className="flex-1">
        <div className="p-3">
          <h2 className="font-medium text-sm mb-2">Element Types</h2>
          <div className="space-y-1">
            {elements.map((element) => (
              <Button
                key={element.id}
                variant={selectedTool === element.id ? "secondary" : "ghost"}
                size="sm"
                className="w-full justify-start"
                onClick={() => onToolSelect(element.id)}
              >
                <div className={`h-3 w-3 rounded-full ${element.color} mr-2`}></div>
                <element.icon className="h-4 w-4 mr-2" />
                {element.label}
              </Button>
            ))}
          </div>
        </div>
        
        <Separator />
        
        <div className="p-3">
          <h2 className="font-medium text-sm mb-2">Points of Interest</h2>
          <div className="space-y-1">
            {pois.map((poi) => (
              <Button
                key={poi.id}
                variant={selectedTool === `poi-${poi.id}` ? "secondary" : "ghost"}
                size="sm"
                className="w-full justify-start"
                onClick={() => onToolSelect(`poi-${poi.id}`)}
              >
                <poi.icon className="h-4 w-4 mr-2" />
                {poi.label}
              </Button>
            ))}
            
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-start"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add Custom POI
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-60">
                <div className="flex gap-2">
                  <Input 
                    value={newPoiName}
                    onChange={(e) => setNewPoiName(e.target.value)}
                    placeholder="POI Name"
                    className="flex-1"
                  />
                  <Button size="sm" onClick={handleAddCustomPoi}>Add</Button>
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>

        <Separator />
        
        <div className="p-3">
          <h2 className="font-medium text-sm mb-2">Connectors</h2>
          <div className="space-y-1">
            {connectors.map((connector) => (
              <Button
                key={connector.id}
                variant={selectedTool === connector.id ? "secondary" : "ghost"}
                size="sm"
                className="w-full justify-start"
                onClick={() => onToolSelect(connector.id)}
              >
                <connector.icon className="h-4 w-4 mr-2" />
                {connector.label}
              </Button>
            ))}
          </div>
        </div>
      </ScrollArea>
    </div>
  );
};

export default LeftSidebar;
