
import { 
  Save, Download, Undo, Redo, Grid, Tag, Share2, Plus
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface TopNavBarProps {
  onExport: (format: string) => void;
  showGrid: boolean;
  onToggleGrid: () => void;
  showLabels: boolean;
  onToggleLabels: () => void;
  showEdges: boolean;
  onToggleEdges: () => void;
  floors: string[];
  currentFloor: string;
  onFloorChange: (floor: string) => void;
}

const TopNavBar = ({
  onExport,
  showGrid,
  onToggleGrid,
  showLabels,
  onToggleLabels,
  showEdges,
  onToggleEdges,
  floors,
  currentFloor,
  onFloorChange
}: TopNavBarProps) => {
  return (
    <div className="flex justify-between items-center px-4 py-2 bg-blueprint-secondary text-white">
      <div className="flex items-center space-x-2">
        <h1 className="text-lg font-semibold">Blueprint Designer</h1>
        <div className="flex items-center mx-4 space-x-2">
          <Button variant="outline" size="sm">
            <Save className="h-4 w-4 mr-1" />
            Save
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Download className="h-4 w-4 mr-1" />
                Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onClick={() => onExport('json')}>
                JSON
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onExport('graph')}>
                Graph
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="flex items-center space-x-2">
          <Button variant="ghost" size="sm">
            <Undo className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm">
            <Redo className="h-4 w-4" />
          </Button>
        </div>
      </div>
      
      <div className="flex items-center space-x-6">
        <div className="flex items-center space-x-2">
          <Label htmlFor="grid-toggle" className="text-sm">Grid</Label>
          <Switch 
            id="grid-toggle" 
            checked={showGrid}
            onCheckedChange={onToggleGrid} 
          />
        </div>
        <div className="flex items-center space-x-2">
          <Label htmlFor="labels-toggle" className="text-sm">Labels</Label>
          <Switch 
            id="labels-toggle" 
            checked={showLabels}
            onCheckedChange={onToggleLabels} 
          />
        </div>
        <div className="flex items-center space-x-2">
          <Label htmlFor="edges-toggle" className="text-sm">Edges</Label>
          <Switch 
            id="edges-toggle" 
            checked={showEdges}
            onCheckedChange={onToggleEdges} 
          />
        </div>
      </div>
      
      <div className="flex items-center space-x-2">
        <Select value={currentFloor} onValueChange={onFloorChange}>
          <SelectTrigger className="w-32">
            <SelectValue placeholder="Floor" />
          </SelectTrigger>
          <SelectContent>
            {floors.map((floor) => (
              <SelectItem key={floor} value={floor}>
                {floor}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="ghost" size="icon">
          <Plus className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
};

export default TopNavBar;
