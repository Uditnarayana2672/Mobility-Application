
import { useEffect, useRef } from 'react';
import { 
  Printer, 
  DoorClosed, 
  Stairs, 
  Bench, 
  Square 
} from 'lucide-react';

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
}

const BlueprintCanvas = ({
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
  selectedTool
}: BlueprintCanvasProps) => {
  const canvasRef = useRef<HTMLDivElement>(null);

  const getElementColor = (type: string) => {
    switch (type) {
      case 'room': return 'bg-blueprint-element-room/20 border-blueprint-element-room';
      case 'hallway': return 'bg-blueprint-element-hallway/20 border-blueprint-element-hallway';
      case 'poi': return 'bg-blueprint-element-poi/20 border-blueprint-element-poi';
      case 'entry': return 'bg-blueprint-element-entry/20 border-blueprint-element-entry';
      case 'stairs': return 'bg-blueprint-element-stairs/20 border-blueprint-element-stairs';
      case 'custom': return 'bg-blueprint-element-custom/20 border-blueprint-element-custom';
      default: return 'bg-gray-200/20 border-gray-400';
    }
  };

  const getPoiIcon = (poiType: string) => {
    switch (poiType) {
      case 'printer': return <Printer className="h-5 w-5 text-blueprint-element-poi" />;
      case 'bench': return <Bench className="h-5 w-5 text-blueprint-element-poi" />;
      case 'water': return <Square className="h-5 w-5 text-blueprint-element-poi" />; // Placeholder
      default: return <Square className="h-5 w-5 text-blueprint-element-poi" />;
    }
  };

  const renderGrid = () => {
    if (!showGrid) return null;
    
    const gridSize = 20;
    const gridElements = [];
    const size = 5000; // Large enough to cover viewport
    
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

  const renderConnections = () => {
    if (!showEdges) return null;
    
    return connections.map((connection) => {
      // Find source and target elements
      const source = elements.find(e => e.id === connection.source);
      const target = elements.find(e => e.id === connection.target);
      
      if (!source || !target) return null;
      
      const sourceX = source.x + source.width / 2;
      const sourceY = source.y + source.height / 2;
      const targetX = target.x + target.width / 2;
      const targetY = target.y + target.height / 2;
      
      return (
        <g key={connection.id}>
          <line
            x1={sourceX}
            y1={sourceY}
            x2={targetX}
            y2={targetY}
            stroke="#3498DB"
            strokeWidth="2"
            strokeDasharray={connection.type === 'dashed' ? '5,5' : undefined}
          />
          {connection.directed && (
            <polygon
              points="0,-5 10,0 0,5"
              transform={`translate(${targetX},${targetY}) rotate(${Math.atan2(targetY - sourceY, targetX - sourceX) * 180 / Math.PI})`}
              fill="#3498DB"
            />
          )}
        </g>
      );
    });
  };

  const renderDrawingPreview = () => {
    if (!drawing) return null;
    
    const x = Math.min(startPoint.x, currentPoint.x);
    const y = Math.min(startPoint.y, currentPoint.y);
    const width = Math.abs(currentPoint.x - startPoint.x);
    const height = Math.abs(currentPoint.y - startPoint.y);
    
    let color = '';
    
    switch (selectedTool) {
      case 'room': color = 'stroke-blueprint-element-room fill-blueprint-element-room/20'; break;
      case 'hallway': color = 'stroke-blueprint-element-hallway fill-blueprint-element-hallway/20'; break;
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
  };

  return (
    <div 
      ref={canvasRef}
      className="absolute inset-0 bg-white"
      style={{
        transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
        transformOrigin: '0 0'
      }}
    >
      <svg width="100%" height="100%" className="absolute inset-0">
        {renderGrid()}
        {renderConnections()}
        {renderDrawingPreview()}
      </svg>

      {elements
        .filter(element => element.floor === currentFloor)
        .map(element => {
          const classes = getElementColor(element.type);
          
          if (element.type === 'poi') {
            return (
              <div
                key={element.id}
                className={`absolute rounded-full p-1 border ${classes} flex items-center justify-center`}
                style={{
                  left: element.x - element.width/2,
                  top: element.y - element.height/2,
                  width: element.width,
                  height: element.height
                }}
              >
                {getPoiIcon(element.poiType)}
                {showLabels && (
                  <span className="absolute top-full mt-1 text-xs bg-white px-1 rounded whitespace-nowrap">
                    {element.name}
                  </span>
                )}
              </div>
            );
          }
          
          if (element.type === 'entry') {
            return (
              <div
                key={element.id}
                className={`absolute border ${classes}`}
                style={{
                  left: element.x,
                  top: element.y,
                  width: element.width,
                  height: element.height
                }}
              >
                <DoorClosed className="h-6 w-6 absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 text-blueprint-element-entry" />
                {showLabels && (
                  <span className="absolute bottom-0 left-1/2 transform -translate-x-1/2 translate-y-full mt-1 text-xs bg-white px-1 rounded whitespace-nowrap">
                    {element.name}
                  </span>
                )}
              </div>
            );
          }
          
          if (element.type === 'stairs') {
            return (
              <div
                key={element.id}
                className={`absolute border ${classes}`}
                style={{
                  left: element.x,
                  top: element.y,
                  width: element.width,
                  height: element.height
                }}
              >
                <Stairs className="h-6 w-6 absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 text-blueprint-element-stairs" />
                {showLabels && (
                  <span className="absolute bottom-0 left-1/2 transform -translate-x-1/2 translate-y-full mt-1 text-xs bg-white px-1 rounded whitespace-nowrap">
                    {element.name}
                  </span>
                )}
              </div>
            );
          }
          
          return (
            <div
              key={element.id}
              className={`absolute border ${classes}`}
              style={{
                left: element.x,
                top: element.y,
                width: element.width,
                height: element.height
              }}
            >
              {showLabels && (
                <span className="absolute top-2 left-2 text-xs bg-white/70 px-1 rounded">
                  {element.name}
                </span>
              )}
            </div>
          );
        })}
    </div>
  );
};

export default BlueprintCanvas;
