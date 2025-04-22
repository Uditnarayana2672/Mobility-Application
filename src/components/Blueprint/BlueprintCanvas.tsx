
import React from 'react';
import { Compass } from 'lucide-react';
import BlueprintElements from './BlueprintElements';
import BlueprintConnections from './BlueprintConnections';

interface BlueprintCanvasProps {
  scale: number;
  position: { x: number; y: number };
  showGrid: boolean;
  showLabels: boolean;
  showEdges: boolean;
  elements: any[];
  connections: any[];
  currentFloor: string;
  drawing: boolean;
  startPoint: { x: number; y: number };
  currentPoint: { x: number; y: number };
  selectedTool: string;
  connectingElements: boolean;
  connectionPoints?: { x: number; y: number }[];
  isMultiPointConnecting?: boolean;
  trueNorth?: number;
  originPoint?: { x: number; y: number };
  originSet?: boolean;
}

const BlueprintCanvas: React.FC<BlueprintCanvasProps> = ({
  scale,
  position,
  showGrid,
  showLabels,
  showEdges,
  elements,
  connections,
  currentFloor,
  drawing,
  startPoint,
  currentPoint,
  selectedTool,
  connectingElements,
  connectionPoints = [],
  isMultiPointConnecting = false,
  trueNorth = 0,
  originPoint,
  originSet
}) => {
  const renderGrid = () => {
    if (!showGrid) return null;
    
    const gridSize = 20;
    const gridElements = [];
    const size = 5000;
    
    // Horizontal lines
    for (let i = -size; i <= size; i += gridSize) {
      gridElements.push(
        <line
          key={`h-${i}`}
          x1={-size}
          y1={i}
          x2={size}
          y2={i}
          stroke="#D1D5DB"
          strokeWidth="0.5"
          strokeDasharray="2,2"
        />
      );
    }
    
    // Vertical lines
    for (let i = -size; i <= size; i += gridSize) {
      gridElements.push(
        <line
          key={`v-${i}`}
          x1={i}
          y1={-size}
          x2={i}
          y2={size}
          stroke="#D1D5DB"
          strokeWidth="0.5"
          strokeDasharray="2,2"
        />
      );
    }
    
    return gridElements;
  };

  const renderDrawingPreview = () => {
    if (!drawing) return null;
    
    if (connectingElements || isMultiPointConnecting) {
      if (isMultiPointConnecting && connectionPoints.length > 0) {
        let pathPoints = '';
        connectionPoints.forEach((point, index) => {
          pathPoints += index === 0 ? `M ${point.x} ${point.y} ` : `L ${point.x} ${point.y} `;
        });
        pathPoints += `L ${currentPoint.x} ${currentPoint.y}`;
        
        return (
          <g>
            <path
              d={pathPoints}
              stroke="#6C63FF"
              strokeWidth={2}
              fill="none"
              strokeDasharray="5,5"
            />
            {connectionPoints.map((point, index) => (
              index > 0 && (
                <circle
                  key={`preview-bend-${index}`}
                  cx={point.x}
                  cy={point.y}
                  r={3}
                  fill="#6C63FF"
                  opacity={0.7}
                />
              )
            ))}
          </g>
        );
      }
      
      return (
        <line
          x1={startPoint.x}
          y1={startPoint.y}
          x2={currentPoint.x}
          y2={currentPoint.y}
          stroke="#6C63FF"
          strokeWidth="2"
          strokeDasharray={selectedTool === 'connect-path' ? '5,5' : undefined}
        />
      );
    }
    
    if (['room', 'hallway', 'custom', 'entry', 'stairs', 'wall'].includes(selectedTool)) {
      const x = Math.min(startPoint.x, currentPoint.x);
      const y = Math.min(startPoint.y, currentPoint.y);
      const width = Math.abs(currentPoint.x - startPoint.x);
      const height = Math.abs(currentPoint.y - startPoint.y);
      
      let color = '';
      switch (selectedTool) {
        case 'room': color = 'stroke-blueprint-element-room fill-blueprint-element-room/20'; break;
        case 'hallway': color = 'stroke-blueprint-element-hallway fill-blueprint-element-hallway/20'; break;
        case 'entry': color = 'stroke-blueprint-element-entry fill-blueprint-element-entry/20'; break;
        case 'stairs': color = 'stroke-blueprint-element-stairs fill-blueprint-element-stairs/20'; break;
        case 'wall': color = 'stroke-gray-700 fill-gray-700'; break;
        case 'custom': color = 'stroke-blueprint-element-custom fill-blueprint-element-custom/20'; break;
        default: color = 'stroke-gray-400 fill-gray-200/20';
      }
      
      return (
        <rect
          x={x}
          y={y}
          width={width}
          height={height}
          className={`${color} stroke-2 stroke-dashed`}
        />
      );
    }
  };

  const renderTrueNorth = () => {
    return (
      <g transform={`translate(50, 50) rotate(${trueNorth})`}>
        <Compass className="w-8 h-8 text-blue-600 stroke-2" />
        <text x="0" y="-20" textAnchor="middle" fill="blue" className="text-xs font-bold">N</text>
      </g>
    );
  };

  return (
    <div 
      className="absolute inset-0 bg-white"
      style={{
        transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
        transformOrigin: '0 0'
      }}
    >
      <svg width="100%" height="100%" className="absolute inset-0">
        {renderGrid()}
        <BlueprintConnections
          connections={connections}
          elements={elements}
          currentFloor={currentFloor}
          showEdges={showEdges}
          showLabels={showLabels}
        />
        {renderDrawingPreview()}
        {renderTrueNorth()}
      </svg>

      <BlueprintElements
        elements={elements}
        currentFloor={currentFloor}
        showLabels={showLabels}
      />
    </div>
  );
};

export default BlueprintCanvas;
