
import { useState, useEffect } from 'react';
import Blueprint from '@/components/Blueprint/Blueprint';
import TopNavBar from '@/components/Navigation/TopNavBar';
import LeftSidebar from '@/components/Sidebar/LeftSidebar';
import RightSidebar from '@/components/Sidebar/RightSidebar';
import { toast } from 'sonner';
import { generateUniqueId } from '@/lib/utils';

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
    currentFloor: 'Floor 1'
  });
  const [customPois, setCustomPois] = useState<string[]>([]);

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

  const handleExport = (format: string) => {
    // Generate export data based on the format
    const exportData = {
      floors: blueprintData.floors,
      elements: blueprintData.elements,
      connections: blueprintData.connections,
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
      metadata: {
        lastSaved: new Date().toISOString(),
        customPois: customPois
      }
    };
    
    // Save to localStorage
    localStorage.setItem('blueprintData', JSON.stringify(savedData));
    toast.success('Blueprint saved successfully!');
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
      setBlueprintData({
        elements: jsonData.elements || [],
        connections: jsonData.connections || [],
        floors: jsonData.floors,
        currentFloor: jsonData.currentFloor || jsonData.floors[0]
      });
      
      // Set custom POIs if available
      if (jsonData.metadata?.customPois) {
        setCustomPois(jsonData.metadata.customPois);
      }
      
      toast.success('Blueprint loaded successfully!');
    } catch (error) {
      toast.error('Failed to import blueprint data');
      console.error('Import error:', error);
    }
  };
  
  // Load saved data on initial render
  useEffect(() => {
    const savedData = localStorage.getItem('blueprintData');
    if (savedData) {
      try {
        const parsedData = JSON.parse(savedData);
        setBlueprintData({
          elements: parsedData.elements || [],
          connections: parsedData.connections || [],
          floors: parsedData.floors || ['Floor 1'],
          currentFloor: parsedData.currentFloor || 'Floor 1'
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
          />
        </div>
        <RightSidebar 
          selectedElement={selectedElement}
          onElementUpdate={handleElementUpdate}
        />
      </div>
    </div>
  );
};

export default Index;
