
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { groupBurstPhotos, deduplicateBurstPhotos, selectBestFromBurst } from './burst-detection';
import type { Photo, FaceCluster } from './types';
import * as faceapi from 'face-api.js';

// Mock face-api.js
vi.mock('face-api.js', () => ({
  euclideanDistance: vi.fn(),
}));

describe('burst-detection', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

  describe('groupBurstPhotos', () => {
    it('should return empty array for empty input', () => {
      expect(groupBurstPhotos([])).toEqual([]);
    });

    it('should group photos within 2000ms threshold', () => {
      const photos: Photo[] = [
        { id: '1', timestamp: 1000, faces: [], width: 100, height: 100, name: '1.jpg', url: '1.jpg' } as any,
        { id: '2', timestamp: 2000, faces: [], width: 100, height: 100, name: '2.jpg', url: '2.jpg' } as any, // diff 1000
        { id: '3', timestamp: 4001, faces: [], width: 100, height: 100, name: '3.jpg', url: '3.jpg' } as any, // diff 2001 (new group)
        { id: '4', timestamp: 4500, faces: [], width: 100, height: 100, name: '4.jpg', url: '4.jpg' } as any, // diff 499
      ];

      const groups = groupBurstPhotos(photos);
      expect(groups).toHaveLength(2);
      expect(groups[0]!.photos).toHaveLength(2);
      expect(groups[0]!.photos.map(p => p.id)).toEqual(['1', '2']);
      expect(groups[1]!.photos).toHaveLength(2);
      expect(groups[1]!.photos.map(p => p.id)).toEqual(['3', '4']);
    });

    it('should handle single photo', () => {
        const photos: Photo[] = [
            { id: '1', timestamp: 1000, faces: [], width: 100, height: 100, name: '1.jpg', url: '1.jpg' } as any,
        ];
        const groups = groupBurstPhotos(photos);
        expect(groups).toHaveLength(1);
        expect(groups[0]!.photos).toHaveLength(1);
    });
  });

  describe('selectBestFromBurst', () => {
      it('should return the only photo in a group of size 1', () => {
          const group = { photos: [{ id: '1', timestamp: 1000, faces: [], width: 100, height: 100 } as any] };
          const best = selectBestFromBurst(group, []);
          expect(best.id).toBe('1');
      });

      it('should select photo with more matched subjects', () => {
          // Mock euclideanDistance to simulate matching
           vi.mocked(faceapi.euclideanDistance).mockReturnValue(0.4); // Match (assuming threshold is 0.6)

          const targetCluster: FaceCluster = { id: 'c1', descriptor: new Float32Array(), meanDescriptor: new Float32Array(), memberDescriptors: [] } as any;
          
          const p1: Photo = { id: '1', timestamp: 1000, faces: [{ descriptor: new Float32Array(), box: { width: 10, height: 10 } } as any] } as any;
          const p2: Photo = { id: '2', timestamp: 1100, faces: [] } as any; // No faces

          const group = { photos: [p1, p2] };
          // p1 matches 1 subject (score approx 1000 + small area/count)
          // p2 matches 0 subjects (score 0)

          const best = selectBestFromBurst(group, [targetCluster]);
          expect(best.id).toBe('1');
      });

        it('should select photo with more detected faces if subject matches are equal', () => {
            const p1: Photo = { id: '1', timestamp: 1000, faces: [{ descriptor: new Float32Array(), box: { width: 10, height: 10 } } as any] } as any;
            const p2: Photo = { id: '2', timestamp: 1100, faces: [{ descriptor: new Float32Array(), box: { width: 10, height: 10 } } as any, { descriptor: new Float32Array(), box: { width: 10, height: 10 } } as any] } as any;

            // Both match 0 subjects (if no targets provided)
            const group = { photos: [p1, p2] };
            const best = selectBestFromBurst(group, []);
            expect(best.id).toBe('2');
        });
  });

    describe('deduplicateBurstPhotos', () => {
        it('should reduce the number of photos', () => {
             const photos: Photo[] = [
                { id: '1', timestamp: 1000, faces: [], width: 100, height: 100, name: '1.jpg', url: '1.jpg' } as any,
                { id: '2', timestamp: 2000, faces: [], width: 100, height: 100, name: '2.jpg', url: '2.jpg' } as any, // Group 1
                { id: '3', timestamp: 4001, faces: [], width: 100, height: 100, name: '3.jpg', url: '3.jpg' } as any, // Group 2
            ];
            
            const result = deduplicateBurstPhotos(photos);
            expect(result).toHaveLength(2);
        });
    });
});
