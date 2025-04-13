
import { ZoomIn, ZoomOut, Home } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface BlueprintControlsProps {
  scale: number;
  onZoom: (delta: number) => void;
  position: { x: number; y: number };
  setPosition: (position: { x: number; y: number }) => void;
}

const BlueprintControls = ({
  scale,
  onZoom,
  position,
  setPosition
}: BlueprintControlsProps) => {
  const handleReset = () => {
    setPosition({ x: 0, y: 0 });
  };

  return (
    <div className="absolute bottom-4 right-4 flex flex-col items-center bg-white border border-gray-200 rounded-md shadow-md">
      <Button
        variant="ghost"
        size="icon"
        onClick={() => onZoom(1)}
        className="p-2"
      >
        <ZoomIn className="h-5 w-5" />
      </Button>
      
      <div className="text-xs font-medium py-1">
        {Math.round(scale * 100)}%
      </div>
      
      <Button
        variant="ghost"
        size="icon"
        onClick={() => onZoom(-1)}
        className="p-2"
      >
        <ZoomOut className="h-5 w-5" />
      </Button>
      
      <div className="border-t border-gray-200 w-full my-1" />
      
      <Button
        variant="ghost"
        size="icon"
        onClick={handleReset}
        className="p-2"
      >
        <Home className="h-5 w-5" />
      </Button>
    </div>
  );
};

export default BlueprintControls;
