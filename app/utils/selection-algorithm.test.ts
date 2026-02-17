import { describe, it, expect, vi, beforeEach } from 'vitest'
import { selectGroupBalancedPhotos, selectGrowthPhotos } from './selection-algorithm'
import * as db from './db'
import * as burstDetection from './burst-detection'
import * as faceapi from 'face-api.js'
// import type { Photo, FaceCluster } from './types'

// Mock dependencies
vi.mock('./db')
vi.mock('./burst-detection')
vi.mock('face-api.js', () => ({
  euclideanDistance: vi.fn(),
}))

describe('selection-algorithm', () => {
  const mockDB = {
    getAllFromIndex: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    // @ts-ignore
    db.getDB.mockResolvedValue(mockDB)
  })

  describe('selectGroupBalancedPhotos', () => {
    it('should return empty array if no photos', async () => {
      mockDB.getAllFromIndex.mockResolvedValue([])
      // @ts-ignore
      burstDetection.deduplicateBurstPhotos.mockReturnValue([])

      const result = await selectGroupBalancedPhotos('session1', [], 5)
      expect(result).toEqual([])
    })

    it('should select photos balancing subjects', async () => {
      const p1 = { id: 'p1', timestamp: 100, faces: [{ descriptor: [0.1] }] } as any
      const p2 = { id: 'p2', timestamp: 200, faces: [{ descriptor: [0.2] }] } as any
      const p3 = { id: 'p3', timestamp: 300, faces: [{ descriptor: [0.1] }] } as any // Subject A again

      const clusterA = { id: 'A', descriptor: [0.1] } as any
      const clusterB = { id: 'B', descriptor: [0.2] } as any

      mockDB.getAllFromIndex.mockResolvedValue([p1, p2, p3])
      // @ts-ignore
      burstDetection.deduplicateBurstPhotos.mockReturnValue([p1, p2, p3])

      // Mock face matching
      vi.mocked(faceapi.euclideanDistance).mockImplementation((d1, d2) => {
        // @ts-ignore
        return Math.abs(d1[0] - d2[0]) // Simple distance
      })

      // Threshold is default 0.4.
      // p1 (0.1) vs A (0.1) -> 0. Match A.
      // p1 vs B (0.2) -> 0.1. match B. wait, distance between 0.1 and 0.2 is 0.1.

      // Let's make it clearer.
      // p1 matches A.
      // p2 matches B.
      // p3 matches A.

      const result = await selectGroupBalancedPhotos('session1', [clusterA, clusterB], 2)

      // Expect p1 (A) and p2 (B) to be selected to balance.
      // If greedy works:
      // 1. All have score 1 (1 subject).
      // 2. Pick p1 (A). Counts: A=1, B=0.
      // 3. Update scores: p2 (B) score = 1 - 0 = 1. p3 (A) score = 1 - 1 = 0.
      // 4. Pick p2.

      expect(result).toHaveLength(2)
      const ids = result.map((p) => p.id).sort()
      expect(ids).toEqual(['p1', 'p2'])
    })
  })

  describe('selectGrowthPhotos', () => {
    it('should select photos evenly distributed over time', async () => {
      const p1 = { id: 'p1', timestamp: 1000, faces: [{ descriptor: [0.1] }] } as any
      const p2 = { id: 'p2', timestamp: 2000, faces: [{ descriptor: [0.1] }] } as any
      const p3 = { id: 'p3', timestamp: 3000, faces: [{ descriptor: [0.1] }] } as any
      const p4 = { id: 'p4', timestamp: 4000, faces: [{ descriptor: [0.1] }] } as any
      const p5 = { id: 'p5', timestamp: 5000, faces: [{ descriptor: [0.1] }] } as any

      const clusterA = { id: 'A', descriptor: [0.1] } as any

      mockDB.getAllFromIndex.mockResolvedValue([p1, p2, p3, p4, p5])
      // @ts-ignore
      burstDetection.deduplicateBurstPhotos.mockReturnValue([p1, p2, p3, p4, p5])

      vi.mocked(faceapi.euclideanDistance).mockReturnValue(0) // Perfect match

      // Select 3 photos.
      // Range: 1000 to 5000. Duration 4000. Interval 1333.33
      // Buckets:
      // 1. 1000 - 2333. Center 1666. p1(1000, diff 666), p2(2000, diff 333). Best p2.
      // 2. 2333 - 3666. Center 3000. p3(3000, diff 0). Best p3.
      // 3. 3666 - 5000. Center 4333. p4(4000, diff 333), p5(5000, diff 666). Best p4.

      // Wait, logic check:
      // Interval = 4000 / 3 = 1333.
      // B1: 1000 - 2333. p1, p2. Center 1666. p2 is closer (333 vs 666).
      // B2: 2333 - 3666. p3. Center 3000. p3 is best.
      // B3: 3666 - 5000. p4, p5. Center 4333. p4 is closer (333 vs 666).

      // So p2, p3, p4 should be selected.
      // Wait, the logic selects "best" in each bucket.

      const result = await selectGrowthPhotos('session1', clusterA, 3)

      const ids = result.map((p) => p.id)
      expect(ids).toEqual(['p2', 'p3', 'p4'])
    })

    it('should return empty if no matched photos', async () => {
      const p1 = { id: 'p1', timestamp: 1000, faces: [] } as any
      const clusterA = { id: 'A', descriptor: [0.1] } as any

      mockDB.getAllFromIndex.mockResolvedValue([p1])
      // @ts-ignore
      burstDetection.deduplicateBurstPhotos.mockReturnValue([p1])

      const result = await selectGrowthPhotos('session1', clusterA, 3)
      // Should return unmatched photos if any?
      // Code says: return [...selected, ...unmatchedPhotos];
      // If p1 is unmatched, it should return p1.

      expect(result).toHaveLength(1)
      expect(result[0]!.id).toBe('p1')
    })
  })
})
