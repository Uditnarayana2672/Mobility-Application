
import React from 'react';
import { Printer, DoorClosed, Stars, Sofa, Box, Coffee, Utensils, Droplet } from 'lucide-react';

interface BlueprintElementsProps {
  elements: any[];
  currentFloor: string;
  showLabels: boolean;
}

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

const BlueprintElements: React.FC<BlueprintElementsProps> = ({
  elements,
  currentFloor,
  showLabels
}) => {
  const renderWall = (element: any) => {
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

  return (
    <>
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
    </>
  );
};

export default BlueprintElements;
