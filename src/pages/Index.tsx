import { useState, useEffect, useCallback } from 'react';
import Blueprint from '@/components/Blueprint/Blueprint';
import TopNavBar from '@/components/Navigation/TopNavBar';
import LeftSidebar from '@/components/Sidebar/LeftSidebar';
import RightSidebar from '@/components/Sidebar/RightSidebar';
import { toast } from 'sonner';
import { generateUniqueId } from '@/lib/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { FileJson, Copy, Compass } from 'lucide-react';
import { Undo2, Redo2 } from 'lucide-react';

const Index = () => {
  const [selectedTool, setSelectedTool] = useState('select');
  const [showGrid, setShowGrid] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const [showEdges, setShowEdges] = useState(true);
  const [selectedElement, setSelectedElement] = useState(null);
  const [blueprintData, setBlueprintData] = useState({
    elements: [],
    connections: [],
    floors: ['Floor 1'],
    currentFloor: 'Floor 1',
    trueNorth: 0
  });
  const [customPois, setCustomPois] = useState<string[]>([]);
  const [jsonDialogOpen, setJsonDialogOpen] = useState(false);
  const [currentJson, setCurrentJson] = useState('');
  const [jsonImportDialogOpen, setJsonImportDialogOpen] = useState(false);
  const [importJsonText, setImportJsonText] = useState('');
  
  const [history, setHistory] = useState<Array<any>>([]);
  const [currentHistoryIndex, setCurrentHistoryIndex] = useState(-1);
  const [originElement, setOriginElement] = useState<string | null>(null);

  const saveToHistory = useCallback((newState: any) => {
    const newHistory = history.slice(0, currentHistoryIndex + 1);
    newHistory.push(newState);
    setHistory(newHistory);
    setCurrentHistoryIndex(newHistory.length - 1);
  }, [history, currentHistoryIndex]);

  const handleUndo = useCallback(() => {
    if (currentHistoryIndex > 0) {
      setCurrentHistoryIndex(currentHistoryIndex - 1);
      setBlueprintData(history[currentHistoryIndex - 1]);
    }
  }, [currentHistoryIndex, history]);

  const handleRedo = useCallback(() => {
    if (currentHistoryIndex < history.length - 1) {
      setCurrentHistoryIndex(currentHistoryIndex + 1);
      setBlueprintData(history[currentHistoryIndex + 1]);
    }
  }, [currentHistoryIndex, history]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        if (!e.shiftKey) {
          handleUndo();
        } else {
          handleRedo();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
        e.preventDefault();
        handleRedo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleUndo, handleRedo]);

  useEffect(() => {
    if (blueprintData.elements.length > 0 || blueprintData.connections.length > 0) {
      saveToHistory(blueprintData);
    }
  }, [blueprintData, saveToHistory]);

  const handleToolSelect = (tool: string) => {
    setSelectedTool(tool);
  };

  const handleToggleGrid = () => {
    setShowGrid(!showGrid);
  };

  const handleToggleLabels = () => {
    setShowLabels(!showLabels);
  };

  const handleToggleEdges = () => {
    setShowEdges(!showEdges);
  };

  const handleElementSelect = (element: any) => {
    setSelectedElement(element);
    const mouseEvent = window.event as MouseEvent | undefined;
    if (mouseEvent?.ctrlKey || mouseEvent?.metaKey) {
      setOriginElement(element.id);
      const originX = element.x;
      const originY = element.y;
      
      const updatedElements = blueprintData.elements.map(el => ({
        ...el,
        relativeX: el.x - originX,
        relativeY: el.y - originY
      }));

      setBlueprintData({
        ...blueprintData,
        elements: updatedElements
      });
      
      toast.success('Set as coordinate origin point');
    }
  };

  const handleElementUpdate = (updatedElement: any) => {
    const updatedElements = blueprintData.elements.map(el => 
      el.id === updatedElement.id ? updatedElement : el
    );
    
    setBlueprintData({
      ...blueprintData,
      elements: updatedElements
    });
  };

  const handleAddElement = (element: any) => {
    setBlueprintData({
      ...blueprintData,
      elements: [...blueprintData.elements, element]
    });
  };

  const handleAddConnection = (connection: any) => {
    setBlueprintData({
      ...blueprintData,
      connections: [...blueprintData.connections, connection]
    });
  };

  const handleFloorChange = (floor: string) => {
    setBlueprintData({
      ...blueprintData,
      currentFloor: floor
    });
  };
  
  const handleAddFloor = (floorName: string) => {
    if (!blueprintData.floors.includes(floorName)) {
      setBlueprintData({
        ...blueprintData,
        floors: [...blueprintData.floors, floorName]
      });
    }
  };

  const handleAddCustomPoi = (poiName: string) => {
    const poiId = poiName.toLowerCase().replace(/\s+/g, '-');
    if (!customPois.includes(poiId)) {
      setCustomPois([...customPois, poiId]);
      setSelectedTool(`poi-${poiId}`);
      toast.success(`Added new POI type: ${poiName}`);
    }
  };

  const handleShowCurrentJson = () => {
    const jsonData = {
      floors: blueprintData.floors,
      elements: blueprintData.elements,
      connections: blueprintData.connections,
      currentFloor: blueprintData.currentFloor,
      trueNorth: blueprintData.trueNorth,
      metadata: {
        lastSaved: new Date().toISOString(),
        customPois: customPois
      }
    };
    
    setCurrentJson(JSON.stringify(jsonData, null, 2));
    setJsonDialogOpen(true);
  };
  
  const handleCopyJson = () => {
    navigator.clipboard.writeText(currentJson)
      .then(() => toast.success('JSON copied to clipboard'))
      .catch(() => toast.error('Failed to copy JSON'));
  };

  const handleExport = (format: string) => {
    const exportData = {
      floors: blueprintData.floors,
      elements: blueprintData.elements,
      connections: blueprintData.connections,
      trueNorth: blueprintData.trueNorth,
      metadata: {
        createdAt: new Date().toISOString(),
        format: format,
        customPois: customPois
      }
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `blueprint_export_${new Date().toISOString()}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };
  
  const handleSave = () => {
    const savedData = {
      floors: blueprintData.floors,
      elements: blueprintData.elements,
      connections: blueprintData.connections,
      currentFloor: blueprintData.currentFloor,
      trueNorth: blueprintData.trueNorth,
      metadata: {
        lastSaved: new Date().toISOString(),
        customPois: customPois
      }
    };
    
    localStorage.setItem('blueprintData', JSON.stringify(savedData));
    toast.success('Blueprint saved successfully!');
  };
  
  const handleOpenImportDialog = () => {
    setImportJsonText('');
    setJsonImportDialogOpen(true);
  };
  
  const handleImportJsonFromText = () => {
    try {
      const jsonData = JSON.parse(importJsonText);
      handleImportJson(jsonData);
      setJsonImportDialogOpen(false);
    } catch (error) {
      toast.error('Invalid JSON format');
      console.error('Import error:', error);
    }
  };
  
  const handleImportJson = (jsonData: any) => {
    try {
      if (!jsonData.floors || !Array.isArray(jsonData.floors)) {
        throw new Error('Invalid JSON: missing floors array');
      }
      
      if (!jsonData.elements || !Array.isArray(jsonData.elements)) {
        throw new Error('Invalid JSON: missing elements array');
      }
      
      setBlueprintData({
        elements: jsonData.elements || [],
        connections: jsonData.connections || [],
        floors: jsonData.floors,
        currentFloor: jsonData.currentFloor || jsonData.floors[0],
        trueNorth: jsonData.trueNorth || 0
      });
      
      if (jsonData.metadata?.customPois) {
        setCustomPois(jsonData.metadata.customPois);
      }
      
      toast.success('Blueprint loaded successfully!');
    } catch (error) {
      toast.error('Failed to import blueprint data');
      console.error('Import error:', error);
    }
  };
  
  useEffect(() => {
    const savedData = localStorage.getItem('blueprintData');
    if (savedData) {
      try {
        const parsedData = JSON.parse(savedData);
        setBlueprintData({
          elements: parsedData.elements || [],
          connections: parsedData.connections || [],
          floors: parsedData.floors || ['Floor 1'],
          currentFloor: parsedData.currentFloor || 'Floor 1',
          trueNorth: parsedData.trueNorth || 0
        });
        
        if (parsedData.metadata?.customPois) {
          setCustomPois(parsedData.metadata.customPois);
        }
        
        toast.success('Loaded saved blueprint');
      } catch (e) {
        toast.error('Failed to load saved blueprint');
      }
    }
  }, []);

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const jsonData = JSON.parse(content);
        handleImportJson(jsonData);
      } catch (error) {
        toast.error('Failed to parse JSON file');
        console.error(error);
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="flex flex-col h-screen bg-gray-100">
      <div className="flex items-center gap-2 px-4 py-2 bg-white border-b">
        <Button
          variant="outline"
          size="icon"
          onClick={handleUndo}
          disabled={currentHistoryIndex <= 0}
        >
          <Undo2 className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          onClick={handleRedo}
          disabled={currentHistoryIndex >= history.length - 1}
        >
          <Redo2 className="h-4 w-4" />
        </Button>
        <TopNavBar 
          onExport={handleExport}
          showGrid={showGrid}
          onToggleGrid={handleToggleGrid}
          showLabels={showLabels}
          onToggleLabels={handleToggleLabels}
          showEdges={showEdges}
          onToggleEdges={handleToggleEdges}
          floors={blueprintData.floors}
          currentFloor={blueprintData.currentFloor}
          onFloorChange={handleFloorChange}
          onAddFloor={handleAddFloor}
          onImportJson={handleImportJson}
          onSave={handleSave}
          onShowCurrentJson={handleShowCurrentJson}
        />
      </div>
      
      <div className="flex flex-1 overflow-hidden">
        <LeftSidebar 
          selectedTool={selectedTool} 
          onToolSelect={handleToolSelect} 
          onAddCustomPoi={handleAddCustomPoi}
        />
        <div className="flex-1 overflow-hidden bg-white">
          <Blueprint 
            selectedTool={selectedTool}
            showGrid={showGrid}
            showLabels={showLabels}
            showEdges={showEdges}
            elements={blueprintData.elements}
            connections={blueprintData.connections}
            currentFloor={blueprintData.currentFloor}
            onElementSelect={handleElementSelect}
            onAddElement={handleAddElement}
            onAddConnection={handleAddConnection}
            onElementUpdate={handleElementUpdate}
          />
        </div>
        <RightSidebar 
          selectedElement={selectedElement}
          onElementUpdate={handleElementUpdate}
        />
      </div>

      <Dialog open={jsonDialogOpen} onOpenChange={setJsonDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileJson className="h-5 w-5" /> Current Blueprint JSON
            </DialogTitle>
          </DialogHeader>
          <div className="overflow-auto max-h-[60vh]">
            <Textarea
              className="font-mono text-sm h-96 resize-none"
              readOnly
              value={currentJson}
            />
          </div>
          <DialogFooter>
            <Button onClick={handleCopyJson}>
              <Copy className="h-4 w-4 mr-2" /> Copy JSON
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={jsonImportDialogOpen} onOpenChange={setJsonImportDialogOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileJson className="h-5 w-5" /> Import Blueprint JSON
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Textarea
              className="font-mono text-sm h-64 resize-none"
              placeholder="Paste your JSON here..."
              value={importJsonText}
              onChange={(e) => setImportJsonText(e.target.value)}
            />
            <div className="flex items-center">
              <span className="mr-2">Or upload a file:</span>
              <input type="file" accept=".json" onChange={handleFileUpload} className="text-sm" />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={handleImportJsonFromText} disabled={!importJsonText.trim()}>
              Import JSON
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      <input 
        type="file" 
        id="json-upload" 
        accept=".json" 
        className="hidden"
        onChange={handleFileUpload}
      />
      
      <div className="fixed bottom-6 right-6 flex gap-2">
        <Button 
          onClick={handleSave}
          className="shadow-lg bg-blue-600 hover:bg-blue-700 text-white"
        >
          Save
        </Button>
        <Button 
          onClick={handleShowCurrentJson}
          className="shadow-lg bg-green-600 hover:bg-green-700 text-white"
        >
          View JSON
        </Button>
        <Button 
          onClick={handleOpenImportDialog}
          className="shadow-lg bg-purple-600 hover:bg-purple-700 text-white"
        >
          Import JSON
        </Button>
      </div>
    </div>
  );
};

export default Index;
