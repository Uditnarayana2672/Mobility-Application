
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

// Define history state interface
interface HistoryState {
  elements: any[];
  connections: any[];
}

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
  
  // Add history states for undo/redo
  const [history, setHistory] = useState<HistoryState[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [isUndoRedoAction, setIsUndoRedoAction] = useState(false);

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
  };

  // Add history state when making changes
  const addToHistory = useCallback((elements: any[], connections: any[]) => {
    if (isUndoRedoAction) {
      setIsUndoRedoAction(false);
      return;
    }
    
    const newHistoryState = {
      elements: JSON.parse(JSON.stringify(elements)),
      connections: JSON.parse(JSON.stringify(connections))
    };
    
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(newHistoryState);
    
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
  }, [history, historyIndex, isUndoRedoAction]);

  const handleElementUpdate = (updatedElement: any) => {
    const isConnection = 'source' in updatedElement && 'target' in updatedElement;
    const updatedElements = isConnection ? blueprintData.elements : blueprintData.elements.map(el => 
      el.id === updatedElement.id ? updatedElement : el
    );
    const updatedConnections = isConnection ? blueprintData.connections.map(conn =>
      conn.id === updatedElement.id ? updatedElement : conn
    ) : blueprintData.connections;
    
    setBlueprintData({
      ...blueprintData,
      elements: updatedElements,
      connections: updatedConnections
    });
    setSelectedElement(updatedElement);
    
    addToHistory(updatedElements, updatedConnections);
  };

  const handleAddElement = (element: any) => {
    const newElements = [...blueprintData.elements, element];
    
    setBlueprintData({
      ...blueprintData,
      elements: newElements
    });
    
    addToHistory(newElements, blueprintData.connections);
  };

  const handleAddConnection = (connection: any) => {
    const newConnections = [...blueprintData.connections, connection];
    
    setBlueprintData({
      ...blueprintData,
      connections: newConnections
    });
    
    addToHistory(blueprintData.elements, newConnections);
  };

  const handleDeleteElement = (elementId: string) => {
    const updatedElements = blueprintData.elements.filter(el => el.id !== elementId);
    
    // Also delete any connections that involve this element
    const updatedConnections = blueprintData.connections.filter(
      conn => conn.source !== elementId && conn.target !== elementId
    );
    
    setBlueprintData({
      ...blueprintData,
      elements: updatedElements,
      connections: updatedConnections
    });
    
    setSelectedElement(null);
    
    addToHistory(updatedElements, updatedConnections);
    toast.success("Element deleted");
  };
  
  const handleDeleteConnection = (connectionId: string) => {
    const updatedConnections = blueprintData.connections.filter(conn => conn.id !== connectionId);
    
    setBlueprintData({
      ...blueprintData,
      connections: updatedConnections
    });
    
    setSelectedElement(null);
    
    addToHistory(blueprintData.elements, updatedConnections);
    toast.success("Connection deleted");
  };
  
  const handleMoveElement = (elementId: string, deltaX: number, deltaY: number) => {
    const updatedElements = blueprintData.elements.map(el => {
      if (el.id === elementId) {
        return {
          ...el,
          x: el.x + deltaX,
          y: el.y + deltaY
        };
      }
      return el;
    });
    
    // Update connection points if needed
    const updatedConnections = blueprintData.connections.map(conn => {
      if (conn.source === elementId || conn.target === elementId) {
        if (conn.points && conn.points.length > 0) {
          const newPoints = [...conn.points];
          
          if (conn.source === elementId) {
            // Update source point
            newPoints[0] = {
              x: newPoints[0].x + deltaX,
              y: newPoints[0].y + deltaY
            };
          }
          
          if (conn.target === elementId) {
            // Update target point
            newPoints[newPoints.length - 1] = {
              x: newPoints[newPoints.length - 1].x + deltaX,
              y: newPoints[newPoints.length - 1].y + deltaY
            };
          }
          
          return {
            ...conn,
            points: newPoints
          };
        }
      }
      return conn;
    });
    
    setBlueprintData({
      ...blueprintData,
      elements: updatedElements,
      connections: updatedConnections
    });
    
    addToHistory(updatedElements, updatedConnections);
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
    // Generate current json data
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
    // Generate export data based on the format
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

    // Create a blob and download
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
    
    // Save to localStorage
    localStorage.setItem('blueprintData', JSON.stringify(savedData));
    toast.success('Blueprint saved successfully!');
    
    // Add to history
    addToHistory(blueprintData.elements, blueprintData.connections);
  };
  
  const handleImportJson = (jsonData: any) => {
    try {
      // Validate required structure
      if (!jsonData.floors || !Array.isArray(jsonData.floors)) {
        throw new Error('Invalid JSON: missing floors array');
      }
      
      if (!jsonData.elements || !Array.isArray(jsonData.elements)) {
        throw new Error('Invalid JSON: missing elements array');
      }
      
      // Set the imported data
      const newElements = jsonData.elements || [];
      const newConnections = jsonData.connections || [];
      
      setBlueprintData({
        elements: newElements,
        connections: newConnections,
        floors: jsonData.floors,
        currentFloor: jsonData.currentFloor || jsonData.floors[0],
        trueNorth: jsonData.trueNorth || 0
      });
      setSelectedElement(null);
      
      // Set custom POIs if available
      if (jsonData.metadata?.customPois) {
        setCustomPois(jsonData.metadata.customPois);
      }
      
      // Add to history
      addToHistory(newElements, newConnections);
      
      toast.success('Blueprint loaded successfully!');
    } catch (error) {
      toast.error('Failed to import blueprint data');
      console.error('Import error:', error);
    }
  };
  
  // Undo function
  const handleUndo = useCallback(() => {
    if (historyIndex > 0) {
      setIsUndoRedoAction(true);
      const prevState = history[historyIndex - 1];
      setBlueprintData({
        ...blueprintData,
        elements: prevState.elements,
        connections: prevState.connections
      });
      setHistoryIndex(historyIndex - 1);
      toast.info("Undo");
    }
  }, [historyIndex, history, blueprintData]);
  
  // Redo function
  const handleRedo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      setIsUndoRedoAction(true);
      const nextState = history[historyIndex + 1];
      setBlueprintData({
        ...blueprintData,
        elements: nextState.elements,
        connections: nextState.connections
      });
      setHistoryIndex(historyIndex + 1);
      toast.info("Redo");
    }
  }, [historyIndex, history, blueprintData]);

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        if (!e.shiftKey) {
          e.preventDefault();
          handleUndo();
        } else {
          e.preventDefault();
          handleRedo();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
        e.preventDefault();
        handleRedo();
      }
      
      // Delete key for selected element
      if (e.key === 'Delete' && selectedElement) {
        e.preventDefault();
        if (selectedElement.source) {
          // It's a connection
          handleDeleteConnection(selectedElement.id);
        } else {
          // It's an element
          handleDeleteElement(selectedElement.id);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleUndo, handleRedo, selectedElement]);
  
  // Initialize history with current state on first load
  useEffect(() => {
    const savedData = localStorage.getItem('blueprintData');
    if (savedData) {
      try {
        const parsedData = JSON.parse(savedData);
        const initialElements = parsedData.elements || [];
        const initialConnections = parsedData.connections || [];
        
        setBlueprintData({
          elements: initialElements,
          connections: initialConnections,
          floors: parsedData.floors || ['Floor 1'],
          currentFloor: parsedData.currentFloor || 'Floor 1',
          trueNorth: parsedData.trueNorth || 0
        });
        
        if (parsedData.metadata?.customPois) {
          setCustomPois(parsedData.metadata.customPois);
        }
        
        // Initialize history with loaded state
        setHistory([{ elements: initialElements, connections: initialConnections }]);
        setHistoryIndex(0);
        
        toast.success('Loaded saved blueprint');
      } catch (e) {
        toast.error('Failed to load saved blueprint');
      }
    } else {
      // Initialize with empty state
      setHistory([{ elements: [], connections: [] }]);
      setHistoryIndex(0);
    }
  }, []);

  return (
    <div className="flex flex-col h-screen bg-gray-100">
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
        onUndo={handleUndo}
        onRedo={handleRedo}
      />
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
            onDeleteElement={handleDeleteElement}
            onDeleteConnection={handleDeleteConnection}
            onMoveElement={handleMoveElement}
          />
        </div>
        <RightSidebar 
          selectedElement={selectedElement}
          onElementUpdate={handleElementUpdate}
          onDeleteElement={handleDeleteElement}
          onDeleteConnection={handleDeleteConnection}
        />
      </div>

      {/* JSON View Dialog */}
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
    </div>
  );
};

export default Index;
