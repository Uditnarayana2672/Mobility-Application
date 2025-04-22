
import React from 'react';

interface BlueprintConnectionsProps {
  connections: any[];
  elements: any[];
  currentFloor: string;
  showEdges: boolean;
  showLabels: boolean;
}

const BlueprintConnections: React.FC<BlueprintConnectionsProps> = ({
  connections,
  elements,
  currentFloor,
  showEdges,
  showLabels
}) => {
  if (!showEdges) return null;

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

  return (
    <>
      {connections.map((connection) => {
        if (connection.floor !== currentFloor) return null;
        
        const source = elements.find(e => e.id === connection.source);
        const target = elements.find(e => e.id === connection.target);
        
        if (!source || !target) return null;
        
        const sourceX = source.x + (source.width / 2);
        const sourceY = source.y + (source.height / 2);
        const targetX = target.x + (target.width / 2);
        const targetY = target.y + (target.height / 2);
        
        const angle = Math.atan2(targetY - sourceY, targetX - sourceX) * 180 / Math.PI;
        
        if (connection.type === 'bent' || connection.type === 'multi') {
          const points = connection.points || [];
          if (points.length < 2) {
            return renderStraightConnection(connection, source, target, sourceX, sourceY, targetX, targetY, angle);
          }
          
          let pathPoints = '';
          points.forEach((point: {x: number, y: number}, index: number) => {
            pathPoints += index === 0 ? `M ${point.x} ${point.y} ` : `L ${point.x} ${point.y} `;
          });
          
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
        
        return renderStraightConnection(connection, source, target, sourceX, sourceY, targetX, targetY, angle);
      })}
    </>
  );
};

export default BlueprintConnections;
