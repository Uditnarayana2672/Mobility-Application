
import { useState } from 'react';
import { toast } from 'sonner';

export const useOrigin = () => {
  const [originPoint, setOriginPoint] = useState({ x: 0, y: 0 });
  const [originSet, setOriginSet] = useState(false);

  const setOrigin = (x: number, y: number) => {
    setOriginPoint({ x, y });
    setOriginSet(true);
    toast.success(`Origin set at (${Math.round(x)}, ${Math.round(y)})`);
  };

  return {
    originPoint,
    originSet,
    setOrigin
  };
};
