
import { Button } from "@/components/ui/button";
import { 
  Square, 
  Map, 
  Cross, 
  Compass,
  MapPin, 
  Hand, 
  MoveHorizontal, 
  FileDown, 
  FileUp,
  Printer, 
  Sofa,
  Coffee,
  Droplet,
  Utensils,
  Box,
  DoorClosed,
  Stars,
  PlusCircle,
  Sliders,
  LineChart,
  Workflow,
  ArrowRightFromLine,
  Route,
  CornerUpRight,
  Pipette,
  GripHorizontal,
  Move,
  Footprints
} from "lucide-react";
// Replacing Rectangle with RectangleHorizontal
import { RectangleHorizontal } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { useRef, useState } from "react";

interface LeftSidebarProps {
  selectedTool: string;
  onToolSelect: (tool: string) => void;
  onAddCustomPoi: (poiName: string) => void;
}

const poiTools = [
  { id: 'poi-printer', name: 'Printer', icon: <Printer className="h-4 w-4 mr-2" /> },
  { id: 'poi-bench', name: 'Bench', icon: <Sofa className="h-4 w-4 mr-2" /> },
  { id: 'poi-coffee', name: 'Coffee', icon: <Coffee className="h-4 w-4 mr-2" /> },
  { id: 'poi-water', name: 'Water', icon: <Droplet className="h-4 w-4 mr-2" /> },
  { id: 'poi-food', name: 'Food', icon: <Utensils className="h-4 w-4 mr-2" /> },
];

const LeftSidebar = ({
  selectedTool,
  onToolSelect,
  onAddCustomPoi
}: LeftSidebarProps) => {
  const [showingAddPoi, setShowingAddPoi] = useState(false);
  const [customPoiName, setCustomPoiName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleAddPoi = () => {
    if (customPoiName.trim()) {
      onAddCustomPoi(customPoiName);
      setCustomPoiName('');
      setShowingAddPoi(false);
    }
  };

  const handleToolButtonClick = (toolId: string) => {
    onToolSelect(toolId);
  };

  const renderToolButton = (toolId: string, name: string, icon: React.ReactNode) => {
    return (
      <Button
        variant={selectedTool === toolId ? "default" : "outline"}
        size="sm"
        className="w-full justify-start mb-1"
        onClick={() => handleToolButtonClick(toolId)}
      >
        {icon} {name}
      </Button>
    );
  };

  return (
    <div className="w-60 bg-sidebar border-r border-gray-200 flex flex-col">
      <div className="px-4 py-2">
        <h2 className="text-lg font-semibold">Tools</h2>
      </div>
      
      <ScrollArea className="flex-grow">
        <div className="p-4">
          <div className="mb-4">
            <h3 className="text-sm font-medium mb-2">Selection</h3>
            {renderToolButton('select', 'Select', <Hand className="h-4 w-4 mr-2" />)}
            {renderToolButton('pan', 'Pan', <Move className="h-4 w-4 mr-2" />)}
          </div>

          <Separator className="my-4" />

          <div className="mb-4">
            <h3 className="text-sm font-medium mb-2">Elements</h3>
            {renderToolButton('room', 'Room', <RectangleHorizontal className="h-4 w-4 mr-2" />)}
            {renderToolButton('hallway', 'Hallway', <Footprints className="h-4 w-4 mr-2" />)}
            {renderToolButton('entry', 'Entry/Exit', <DoorClosed className="h-4 w-4 mr-2" />)}
            {renderToolButton('stairs', 'Stairs/Elevator', <Stars className="h-4 w-4 mr-2" />)}
            {renderToolButton('wall', 'Wall', <Square className="h-4 w-4 mr-2" />)}
            {renderToolButton('wall-draw', 'Draw Walls', <Pipette className="h-4 w-4 mr-2" />)}
            {renderToolButton('custom', 'Custom Zone', <GripHorizontal className="h-4 w-4 mr-2" />)}
          </div>

          <Separator className="my-4" />

          <div className="mb-4">
            <h3 className="text-sm font-medium mb-2">Connections</h3>
            {renderToolButton('connect-straight', 'Straight', <ArrowRightFromLine className="h-4 w-4 mr-2" />)}
            {renderToolButton('connect-path', 'Path', <Route className="h-4 w-4 mr-2" />)}
            {renderToolButton('connect-bent', 'Bent', <CornerUpRight className="h-4 w-4 mr-2" />)}
            {renderToolButton('connect-multi', 'Multi-point', <Workflow className="h-4 w-4 mr-2" />)}
          </div>
          
          <Separator className="my-4" />

          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium">Points of Interest</h3>
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => {
                  setShowingAddPoi(!showingAddPoi);
                  setTimeout(() => {
                    inputRef.current?.focus();
                  }, 100);
                }}
              >
                <PlusCircle className="h-4 w-4" />
              </Button>
            </div>

            {showingAddPoi && (
              <div className="flex space-x-2 mb-2">
                <Input 
                  ref={inputRef}
                  value={customPoiName}
                  onChange={(e) => setCustomPoiName(e.target.value)}
                  placeholder="POI name"
                  className="h-8"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleAddPoi();
                    if (e.key === 'Escape') setShowingAddPoi(false);
                  }}
                />
                <Button size="sm" onClick={handleAddPoi}>Add</Button>
              </div>
            )}

            {poiTools.map(tool => renderToolButton(tool.id, tool.name, tool.icon))}
          </div>

          <Separator className="my-4" />

          <div className="mb-4">
            <h3 className="text-sm font-medium mb-2">Utilities</h3>
            {renderToolButton('coordinates', 'Coordinates', <MapPin className="h-4 w-4 mr-2" />)}
            {renderToolButton('true-north', 'True North', <Compass className="h-4 w-4 mr-2" />)}
          </div>
        </div>
      </ScrollArea>
    </div>
  );
};

export default LeftSidebar;
