import { useState } from 'react';
import { Link } from 'react-router-dom';
import { mapsHref } from '@/shared/mapsLink';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { 
  Grid3x3, 
  Tag, 
  Box, 
  Save, 
  Download, 
  Upload, 
  Plus,
  MoreVertical,
  FileJson,
  Undo,
  Redo,
  Trash,
  Map as MapIcon
} from 'lucide-react';
import { toast } from 'sonner';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';

interface TopNavBarProps {
  showGrid: boolean;
  onToggleGrid: () => void;
  showLabels: boolean;
  onToggleLabels: () => void;
  showEdges: boolean;
  onToggleEdges: () => void;
  floors: string[];
  currentFloor: string;
  onFloorChange: (floor: string) => void;
  onAddFloor: (floorName: string) => void;
  onImportJson: (jsonData: any) => void;
  onSave: () => void;
  onShowCurrentJson: () => void;
  onExport: (format: string) => void;
  onUndo?: () => void;
  onRedo?: () => void;
}

const TopNavBar = ({
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
  onSave,
  onShowCurrentJson,
  onExport,
  onUndo,
  onRedo
}: TopNavBarProps) => {
  const [newFloorName, setNewFloorName] = useState('');
  const [jsonData, setJsonData] = useState('');

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

  const handleJsonImport = () => {
    try {
      if (!jsonData.trim() || !onImportJson) return;
      const parsedData = JSON.parse(jsonData);
      onImportJson(parsedData);
      toast.success('Blueprint imported successfully');
    } catch (error) {
      toast.error('Failed to import blueprint. Invalid JSON format.');
    }
  };

  const handleLoadSample = async () => {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}maps/blr-kia-t2.json`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      onImportJson(await res.json());
    } catch (error) {
      toast.error('Failed to load sample map');
    }
  };

  return (
    <div className="flex justify-between items-center px-4 py-2 bg-blueprint-secondary text-white">
      <div className="flex items-center space-x-2">
        <h1 className="text-lg font-semibold">Blueprint Designer</h1>
        <Button asChild variant="outline" size="sm" className="bg-white/10 text-white hover:bg-white hover:text-blueprint-secondary" data-testid="go-maps">
          <Link to={mapsHref()}><MapIcon className="h-4 w-4 mr-1" />Indore Maps</Link>
        </Button>
        <div className="flex items-center mx-4 space-x-2">
          <Button variant="outline" size="sm" className="bg-white/10 text-white hover:bg-white hover:text-blueprint-secondary" onClick={onSave}>
            <Save className="h-4 w-4 mr-1" />
            Save
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="bg-white/10 text-white hover:bg-white hover:text-blueprint-secondary">
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
          <Button variant="ghost" size="sm" className="text-white hover:bg-white/20">
            <Undo className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" className="text-white hover:bg-white/20">
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
        
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" className="bg-white/10 text-white hover:bg-white hover:text-blueprint-secondary">
              <FileJson className="h-4 w-4 mr-1" />
              JSON
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>JSON Operations</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col space-y-4">
              <div>
                <h3 className="font-medium mb-2">Import Blueprint</h3>
                <div className="flex flex-col space-y-2">
                  <Input 
                    type="file" 
                    accept=".json" 
                    onChange={handleFileImport}
                    className="mb-2"
                  />
                  <p className="text-xs text-gray-500">Or paste JSON directly:</p>
                  <Textarea 
                    placeholder="Paste JSON data here..." 
                    value={jsonData}
                    onChange={(e) => setJsonData(e.target.value)}
                    className="h-32"
                  />
                  <Button onClick={handleJsonImport} className="w-full">Import from Text</Button>
                  <Button onClick={handleLoadSample} variant="secondary" className="w-full">
                    Load Sample: Bengaluru KIA Terminal 2
                  </Button>
                </div>
              </div>
              <div className="border-t pt-4">
                <h3 className="font-medium mb-2">View Current Blueprint JSON</h3>
                <Button onClick={onShowCurrentJson} variant="outline" className="w-full">
                  Show Current JSON
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" className="bg-white/10 text-white hover:bg-white hover:text-blueprint-secondary">
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
          <SelectTrigger className="w-32 bg-white/10 text-white border-white/20">
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
        
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="ghost" size="icon" className="text-white hover:bg-white/20">
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
