
import { 
  Save, Download, Undo, Redo, Grid, Tag, Share2, Plus, Upload
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
import { Input } from '@/components/ui/input';
import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { toast } from 'sonner';

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
  onAddFloor?: (floorName: string) => void;
  onImportJson?: (jsonData: any) => void;
  onSave?: () => void;
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
  onFloorChange,
  onAddFloor,
  onImportJson,
  onSave
}: TopNavBarProps) => {
  const [newFloorName, setNewFloorName] = useState('');

  const handleAddFloor = () => {
    if (newFloorName.trim() && onAddFloor) {
      onAddFloor(newFloorName.trim());
      setNewFloorName('');
      toast.success(`Added new floor: ${newFloorName.trim()}`);
    }
  };

  const handleFileImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || !e.target.files[0] || !onImportJson) return;
    
    const file = e.target.files[0];
    const reader = new FileReader();

    reader.onload = (event) => {
      try {
        if (!event.target || typeof event.target.result !== 'string') return;
        const jsonData = JSON.parse(event.target.result);
        onImportJson(jsonData);
        toast.success('Blueprint imported successfully');
      } catch (error) {
        toast.error('Failed to import blueprint. Invalid JSON format.');
      }
    };

    reader.onerror = () => {
      toast.error('Failed to read file');
    };

    reader.readAsText(file);
  };

  return (
    <div className="flex justify-between items-center px-4 py-2 bg-blueprint-secondary text-white">
      <div className="flex items-center space-x-2">
        <h1 className="text-lg font-semibold">Blueprint Designer</h1>
        <div className="flex items-center mx-4 space-x-2">
          <Button variant="outline" size="sm" className="text-white hover:text-blueprint-secondary" onClick={onSave}>
            <Save className="h-4 w-4 mr-1" />
            Save
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="text-white hover:text-blueprint-secondary">
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
          <Button variant="ghost" size="sm" className="text-white">
            <Undo className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" className="text-white">
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
        
        {/* Import JSON Button */}
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" className="text-white hover:text-blueprint-secondary">
              <Upload className="h-4 w-4 mr-1" />
              Import
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Import Blueprint</DialogTitle>
            </DialogHeader>
            <Input 
              type="file" 
              accept=".json" 
              onChange={handleFileImport}
              className="mt-2"
            />
          </DialogContent>
        </Dialog>
      </div>
      
      <div className="flex items-center space-x-2">
        <Select value={currentFloor} onValueChange={onFloorChange}>
          <SelectTrigger className="w-32 text-white bg-transparent border-white">
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
        
        {/* Add Floor Dialog */}
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="ghost" size="icon" className="text-white">
              <Plus className="h-4 w-4" />
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add New Floor</DialogTitle>
            </DialogHeader>
            <div className="flex items-center space-x-2 mt-2">
              <Input 
                placeholder="Floor Name" 
                value={newFloorName} 
                onChange={(e) => setNewFloorName(e.target.value)} 
              />
              <Button onClick={handleAddFloor}>Add</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
};

export default TopNavBar;
