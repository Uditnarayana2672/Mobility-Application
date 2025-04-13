
import { 
  MousePointer, 
  Square, 
  Columns, 
  Printer, 
  DoorClosed, 
  Stairs, 
  Box, 
  PolygonIcon, 
  LineIcon, 
  Move, 
  BellRing, 
  Bench
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';

interface LeftSidebarProps {
  selectedTool: string;
  onToolSelect: (tool: string) => void;
}

const LeftSidebar = ({ selectedTool, onToolSelect }: LeftSidebarProps) => {
  
  const tools = [
    { id: 'select', icon: MousePointer, label: 'Select' },
    { id: 'draw-polygon', icon: PolygonIcon, label: 'Polygon' },
    { id: 'draw-line', icon: LineIcon, label: 'Line' },
    { id: 'pan', icon: Move, label: 'Pan' },
  ];
  
  const elements = [
    { id: 'room', icon: Square, label: 'Room', color: 'bg-blueprint-element-room' },
    { id: 'hallway', icon: Columns, label: 'Hallway', color: 'bg-blueprint-element-hallway' },
    { id: 'poi', icon: BellRing, label: 'POI', color: 'bg-blueprint-element-poi' },
    { id: 'entry', icon: DoorClosed, label: 'Entry/Exit', color: 'bg-blueprint-element-entry' },
    { id: 'stairs', icon: Stairs, label: 'Stairs/Elevator', color: 'bg-blueprint-element-stairs' },
    { id: 'custom', icon: Box, label: 'Custom Zone', color: 'bg-blueprint-element-custom' },
  ];
  
  const pois = [
    { id: 'printer', icon: Printer, label: 'Printer' },
    { id: 'bench', icon: Bench, label: 'Bench' },
    { id: 'water', icon: Box, label: 'Water Cooler' },
  ];
  
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
                variant="ghost"
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
                variant="ghost"
                size="sm"
                className="w-full justify-start"
                onClick={() => onToolSelect(`poi-${poi.id}`)}
              >
                <poi.icon className="h-4 w-4 mr-2" />
                {poi.label}
              </Button>
            ))}
          </div>
        </div>
      </ScrollArea>
    </div>
  );
};

export default LeftSidebar;
