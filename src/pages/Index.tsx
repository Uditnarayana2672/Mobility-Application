
import { useState } from 'react';
import Blueprint from '@/components/Blueprint/Blueprint';
import TopNavBar from '@/components/Navigation/TopNavBar';
import LeftSidebar from '@/components/Sidebar/LeftSidebar';
import RightSidebar from '@/components/Sidebar/RightSidebar';

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

  const handleExport = (format: string) => {
    // Generate export data based on the format
    const exportData = {
      floors: blueprintData.floors,
      elements: blueprintData.elements,
      connections: blueprintData.connections,
      metadata: {
        createdAt: new Date().toISOString(),
        format: format
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
      />
      <div className="flex flex-1 overflow-hidden">
        <LeftSidebar 
          selectedTool={selectedTool} 
          onToolSelect={handleToolSelect} 
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
