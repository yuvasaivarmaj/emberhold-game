// Generates the terrain heightfield off the main thread.
import { generateHeights } from './HeightGen';

self.onmessage = () => {
  const data = generateHeights((p) => (self as any).postMessage({ type: 'progress', p }));
  (self as any).postMessage({ type: 'done', data }, [data.buffer]);
};
