
import { useEffect, useRef } from 'react';
import { 
  Printer, 
  DoorClosed, 
  Stars, 
  Sofa, 
  Square,
  Coffee,
  Utensils,
  Droplet,
  Box,
  Compass
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
  connectingElements: boolean;
  connectionPoints?: { x: number; y: number }[];
  isMultiPointConnecting?: boolean;
  trueNorth?: number; // True north orientation in degrees
  isDrawingWall?: boolean;
  wallPoints?: { x: number; y: number }[];
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
  selectedTool,
  connectingElements,
  connectionPoints = [],
  isMultiPointConnecting = false,
  trueNorth = 0,
  isDrawingWall = false,
  wallPoints = []
}: BlueprintCanvasProps) => {
  const canvasRef = useRef<HTMLDivElement>(null);

  const getElementColor = (type: string) => {
    switch (type) {
      case 'room': return 'bg-blueprint-element-room/20 border-blueprint-element-room';
      case 'hallway': return 'bg-blueprint-element-hallway/20 border-blueprint-element-hallway';
      case 'poi': return 'bg-blueprint-element-poi/20 border-blueprint-element-poi';
      case 'entry': return 'bg-blueprint-element-entry/20 border-blueprint-element-entry';
      case 'stairs': return 'bg-blueprint-element-stairs/20 border-blueprint-element-stairs';
      case 'wall': return 'bg-gray-700 border-gray-800';
      case 'custom': return 'bg-blueprint-element-custom/20 border-blueprint-element-custom';
      default: return 'bg-gray-200/20 border-gray-400';
    }
  };

  const getPoiIcon = (poiType: string) => {
    switch (poiType) {
      case 'printer': return <Printer className="h-5 w-5 text-blueprint-element-poi" />;
      case 'bench': return <Sofa className="h-5 w-5 text-blueprint-element-poi" />;
      case 'water': return <Droplet className="h-5 w-5 text-blueprint-element-poi" />;
      case 'coffee': return <Coffee className="h-5 w-5 text-blueprint-element-poi" />;
      case 'food': return <Utensils className="h-5 w-5 text-blueprint-element-poi" />;
      default: return <Box className="h-5 w-5 text-blueprint-element-poi" />;
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
      // Only show connections for current floor
      if (connection.floor !== currentFloor) return null;
      
      // Find source and target elements
      const source = elements.find(e => e.id === connection.source);
      const target = elements.find(e => e.id === connection.target);
      
      if (!source || !target) return null;
      
      const sourceX = source.x + (source.width / 2);
      const sourceY = source.y + (source.height / 2);
      const targetX = target.x + (target.width / 2);
      const targetY = target.y + (target.height / 2);
      
      // Calculate arrow angle for directed connections
      const angle = Math.atan2(targetY - sourceY, targetX - sourceX) * 180 / Math.PI;
      
      // Handle different connection types
      if (connection.type === 'bent' || connection.type === 'multi') {
        const points = connection.points || [];
        if (points.length < 2) {
          // Fallback to straight line if no points
          return renderStraightConnection(connection, source, target, sourceX, sourceY, targetX, targetY, angle);
        }
        
        // Create polyline path
        let pathPoints = '';
        points.forEach((point: {x: number, y: number}, index: number) => {
          pathPoints += index === 0 ? `M ${point.x} ${point.y} ` : `L ${point.x} ${point.y} `;
        });
        
        // Calculate arrow angle from the last segment
        const lastPoint = points[points.length - 2] || { x: sourceX, y: sourceY };
        const arrowAngle = Math.atan2(targetY - lastPoint.y, targetX - lastPoint.x) * 180 / Math.PI;
        
        return (
          <g key={connection.id}>
            <path
              d={pathPoints}
              stroke={connection.allow_vehicles ? "#3498DB" : "#6C63FF"}
              strokeWidth={connection.width || 2}
              fill="none"
              strokeDasharray={connection.type === 'multi' ? '5,5' : undefined}
            />
            
            {connection.directed && (
              <polygon
                points="0,-5 10,0 0,5"
                transform={`translate(${targetX - 10 * Math.cos(arrowAngle * Math.PI / 180)},${targetY - 10 * Math.sin(arrowAngle * Math.PI / 180)}) rotate(${arrowAngle})`}
                fill={connection.allow_vehicles ? "#3498DB" : "#6C63FF"}
              />
            )}
            
            {showLabels && connection.label && (
              <text
                x={(sourceX + targetX) / 2}
                y={(sourceY + targetY) / 2 - 10}
                textAnchor="middle"
                className="fill-black text-xs bg-white px-1 rounded"
              >
                {connection.label}
                {connection.distance ? ` (${connection.distance}m)` : ''}
              </text>
            )}
            
            {/* Render bend points as small circles */}
            {points.map((point: {x: number, y: number}, index: number) => (
              index !== 0 && index !== points.length - 1 && (
                <circle
                  key={`bend-${index}`}
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
      
      // Standard straight or path connection
      return renderStraightConnection(connection, source, target, sourceX, sourceY, targetX, targetY, angle);
    });
  };
  
  const renderStraightConnection = (
    connection: any, 
    source: any, 
    target: any, 
    sourceX: number, 
    sourceY: number, 
    targetX: number, 
    targetY: number, 
    angle: number
  ) => {
    return (
      <g key={connection.id}>
        <line
          x1={sourceX}
          y1={sourceY}
          x2={targetX}
          y2={targetY}
          stroke={connection.allow_vehicles ? "#3498DB" : "#6C63FF"}
          strokeWidth={connection.width || 2}
          strokeDasharray={connection.type === 'path' ? '5,5' : undefined}
          className={!connection.wheelchair_accessible ? "opacity-50" : ""}
        />
        {connection.directed && (
          <polygon
            points="0,-5 10,0 0,5"
            transform={`translate(${targetX - 10 * Math.cos(angle * Math.PI / 180)},${targetY - 10 * Math.sin(angle * Math.PI / 180)}) rotate(${angle})`}
            fill={connection.allow_vehicles ? "#3498DB" : "#6C63FF"}
          />
        )}
        {showLabels && (
          <g>
            {connection.label && (
              <text
                x={(sourceX + targetX) / 2}
                y={(sourceY + targetY) / 2 - 10}
                textAnchor="middle"
                className="fill-black text-xs bg-white px-1 py-0.5 rounded"
              >
                {connection.label}
              </text>
            )}
            
            {connection.distance > 0 && (
              <text
                x={(sourceX + targetX) / 2}
                y={(sourceY + targetY) / 2 + 10}
                textAnchor="middle"
                className="fill-black text-xs bg-white/70 px-1 py-0.5 rounded"
              >
                {connection.distance}m
              </text>
            )}
          </g>
        )}
      </g>
    );
  };

  const renderDrawingPreview = () => {
    // Wall drawing preview
    if (isDrawingWall && wallPoints.length > 0) {
      let pathPoints = '';
      wallPoints.forEach((point, index) => {
        pathPoints += index === 0 ? `M ${point.x} ${point.y} ` : `L ${point.x} ${point.y} `;
      });
      pathPoints += `L ${currentPoint.x} ${currentPoint.y}`;
      
      return (
        <g>
          <path
            d={pathPoints}
            stroke="#4B5563"
            strokeWidth={2}
            fill="none"
          />
          {wallPoints.map((point, index) => (
            <circle
              key={`wall-point-${index}`}
              cx={point.x}
              cy={point.y}
              r={3}
              fill="#4B5563"
            />
          ))}
          <circle
            cx={currentPoint.x}
            cy={currentPoint.y}
            r={3}
            fill="#4B5563"
            opacity={0.5}
          />
        </g>
      );
    }
  
    if (!drawing) return null;
    
    if (connectingElements || isMultiPointConnecting) {
      // Multi-point connection preview
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
      
      // Basic connection preview
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
  
  const renderCoordinatesMarker = (element: any) => {
    if (!element.latitude || !element.longitude) return null;
    
    let markerX = element.x + element.width / 2;
    let markerY = element.y + element.height / 2;
    
    // Adjust based on coordinate position if specified
    switch (element.coordinatePosition) {
      case 'top-left':
        markerX = element.x;
        markerY = element.y;
        break;
      case 'top-right':
        markerX = element.x + element.width;
        markerY = element.y;
        break;
      case 'bottom-left':
        markerX = element.x;
        markerY = element.y + element.height;
        break;
      case 'bottom-right':
        markerX = element.x + element.width;
        markerY = element.y + element.height;
        break;
    }
    
    return (
      <g>
        <circle
          cx={markerX}
          cy={markerY}
          r={3}
          fill="red"
          stroke="white"
          strokeWidth={1}
        />
        {showLabels && (
          <text
            x={markerX + 5}
            y={markerY - 5}
            textAnchor="start"
            className="fill-black text-[10px] bg-white/80 px-1 py-0.5 rounded"
          >
            {element.latitude}, {element.longitude}
          </text>
        )}
      </g>
    );
  };

  const renderTrueNorth = () => {
    return (
      <g transform={`translate(50, 50) rotate(${trueNorth})`}>
        <Compass className="w-8 h-8 text-blue-600 stroke-2" />
        <text x="0" y="-20" textAnchor="middle" fill="blue" className="text-xs font-bold">N</text>
      </g>
    );
  };

  const renderWall = (element: any) => {
    // Apply rotation if specified (for wall segments)
    let transform = '';
    if (element.rotation) {
      // Calculate center of the element for rotation
      const centerX = element.x + element.width / 2;
      const centerY = element.y + element.height / 2;
      transform = `transform: rotate(${element.rotation}deg); transform-origin: ${centerX}px ${centerY}px;`;
    }
    
    return (
      <div
        key={element.id}
        className="absolute border-0 bg-gray-700"
        style={{
          left: element.x,
          top: element.y,
          width: element.width,
          height: element.height,
          opacity: 0.9,
          transform: element.rotation ? `rotate(${element.rotation}deg)` : '',
          transformOrigin: element.rotation ? 'left center' : '',
        }}
      >
        {showLabels && element.label && (
          <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 text-xs bg-white/70 px-1 py-0.5 rounded whitespace-nowrap">
            {element.label}
          </div>
        )}
      </div>
    );
  };

  // Render resize handles for elements
  const renderResizeHandles = (element: any) => {
    const handlePositions = [
      { key: 'nw', x: element.x, y: element.y, cursor: 'nwse-resize' },
      { key: 'n', x: element.x + element.width / 2, y: element.y, cursor: 'ns-resize' },
      { key: 'ne', x: element.x + element.width, y: element.y, cursor: 'nesw-resize' },
      { key: 'e', x: element.x + element.width, y: element.y + element.height / 2, cursor: 'ew-resize' },
      { key: 'se', x: element.x + element.width, y: element.y + element.height, cursor: 'nwse-resize' },
      { key: 's', x: element.x + element.width / 2, y: element.y + element.height, cursor: 'ns-resize' },
      { key: 'sw', x: element.x, y: element.y + element.height, cursor: 'nesw-resize' },
      { key: 'w', x: element.x, y: element.y + element.height / 2, cursor: 'ew-resize' }
    ];
    
    return (
      <g>
        {handlePositions.map(handle => (
          <circle
            key={`handle-${element.id}-${handle.key}`}
            cx={handle.x}
            cy={handle.y}
            r={5}
            className="fill-blue-500 stroke-white stroke-1 opacity-60"
            style={{ cursor: handle.cursor }}
          />
        ))}
      </g>
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
        {renderTrueNorth()}
        {/* Render coordinate markers */}
        {showLabels && elements
          .filter(element => element.floor === currentFloor && element.latitude && element.longitude)
          .map(element => (
            <g key={`coords-${element.id}`}>
              {renderCoordinatesMarker(element)}
            </g>
          ))
        }
      </svg>

      {elements
        .filter(element => element.floor === currentFloor)
        .map(element => {
          if (element.type === 'wall') {
            return renderWall(element);
          }
          
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
                className={`absolute border ${classes} overflow-hidden`}
                style={{
                  left: element.x,
                  top: element.y,
                  width: element.width,
                  height: element.height,
                  backgroundImage: element.imageUrl ? `url(${element.imageUrl})` : 'none',
                  backgroundSize: 'cover',
                  backgroundPosition: 'center'
                }}
              >
                {!element.imageUrl && (
                  <DoorClosed className="h-6 w-6 absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 text-blueprint-element-entry" />
                )}
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
                className={`absolute border ${classes} overflow-hidden`}
                style={{
                  left: element.x,
                  top: element.y,
                  width: element.width,
                  height: element.height,
                  backgroundImage: element.imageUrl ? `url(${element.imageUrl})` : 'none',
                  backgroundSize: 'cover',
                  backgroundPosition: 'center'
                }}
              >
                {!element.imageUrl && (
                  <Stars className="h-6 w-6 absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 text-blueprint-element-stairs" />
                )}
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
              className={`absolute border ${classes} overflow-hidden`}
              style={{
                left: element.x,
                top: element.y,
                width: element.width,
                height: element.height,
                backgroundImage: element.imageUrl ? `url(${element.imageUrl})` : 'none',
                backgroundSize: 'cover',
                backgroundPosition: 'center'
              }}
            >
              {showLabels && element.label && (
                <div className="absolute top-2 left-2 text-xs bg-white/70 px-1 rounded">
                  {element.label}
                </div>
              )}
              
              {!element.label && showLabels && (
                <div className="absolute top-2 left-2 text-xs bg-white/70 px-1 rounded">
                  {element.name}
                </div>
              )}
              
              {element.capacity > 0 && showLabels && (
                <div className="absolute bottom-2 right-2 text-xs bg-white/70 px-1 rounded">
                  Cap: {element.capacity}
                </div>
              )}
              {element.dimension && element.width > 0 && showLabels && (
                <div className="absolute bottom-2 left-2 text-xs bg-white/70 px-1 rounded">
                  {element.width}x{element.height} {element.dimension}
                </div>
              )}
            </div>
          );
        })}
    </div>
  );
};

export default BlueprintCanvas;
