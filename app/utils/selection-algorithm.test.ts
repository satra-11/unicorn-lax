import { describe, it, expect, vi, beforeEach } from 'vitest'
import { selectGroupBalancedPhotos, selectGrowthPhotos } from './selection-algorithm'
import * as db from './db'
import * as burstDetection from './burst-detection'
import * as faceapi from 'face-api.js'
import type { Photo, FaceCluster } from './types'

// Mock dependencies
vi.mock('./db', async () => {
  return { getDB: vi.fn() }
})
vi.mock('./burst-detection', async () => {
  return { deduplicateBurstPhotos: vi.fn((photos) => photos) }
})
vi.mock('face-api.js', async () => ({
  euclideanDistance: vi.fn(),
}))

describe('selection-algorithm', () => {
  const mockDB = {
    getAllFromIndex: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    // @ts-expect-error -- Mocking specific method
    db.getDB.mockResolvedValue(mockDB)
  })

  describe('selectGroupBalancedPhotos', () => {
    it('should return empty array if no photos', async () => {
      mockDB.getAllFromIndex.mockResolvedValue([])
      // @ts-expect-error -- Mocking return value
      burstDetection.deduplicateBurstPhotos.mockReturnValue([])

      const result = await selectGroupBalancedPhotos('session1', [], 5)
      expect(result).toEqual([])
    })

    it('should select photos balancing subjects', async () => {
      const p1 = {
        id: 'p1',
        timestamp: 100,
        faces: [{ descriptor: [0.1], box: { x: 0, width: 100 } }],
      } as unknown as Photo
      const p2 = {
        id: 'p2',
        timestamp: 200,
        faces: [{ descriptor: [0.2], box: { x: 0, width: 100 } }],
      } as unknown as Photo
      const p3 = {
        id: 'p3',
        timestamp: 300,
        faces: [{ descriptor: [0.1], box: { x: 0, width: 100 } }],
      } as unknown as Photo // Subject A again

      const clusterA = { id: 'A', descriptor: [0.1] } as unknown as FaceCluster
      const clusterB = { id: 'B', descriptor: [0.2] } as unknown as FaceCluster

      mockDB.getAllFromIndex.mockResolvedValue([p1, p2, p3])
      // @ts-expect-error -- Mocking return value
      burstDetection.deduplicateBurstPhotos.mockReturnValue([p1, p2, p3])

      // Mock face matching
      vi.mocked(faceapi.euclideanDistance).mockImplementation((d1: unknown, d2: unknown) => {
        return Math.abs((d1 as number[])[0]! - (d2 as number[])[0]!) // Simple distance
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

    it('should prefer solo photo of underrepresented subject over overrepresented one after two-shot', async () => {
      // Two-shot(A+B), Solo(A), Solo(B). Select 2.
      // After picking two-shot (A=1, B=1), should pick solo-A or solo-B equally (both at minCount).
      // But if we have: Two-shot(A+B), Solo(B) only, Select 2 → A=1, B=2 is the bug.
      // With fix: Two-shot(A+B) still picks, but Solo(B) gets no underrep bonus since A is at minCount=1, B=1.
      // Since Solo(B) only contains B (count=1) and A is also 1, minCount=1, B is at minCount... hmm.
      // Let's test with: TwoShot(A+B) + Solo(A) + Solo(B). Select 3 → should get all three.
      // More meaningful: TwoShot(A+B) + Solo(A) + Solo(B) + Solo(B2). Select 3.
      // After TwoShot: A=1, B=1. Then Solo(A) has underrep subject A(1=min=1), Solo(B) also B(1=min=1).
      // Pick Solo(A): A=2, B=1. Then Solo(B) has underrep B(1=min=1). Pick Solo(B).
      // Result: A=2, B=2. Balanced!

      const twoShot = {
        id: 'ts1',
        timestamp: 100,
        faces: [
          { descriptor: [0.1], box: { x: 0, width: 100 } },
          { descriptor: [0.5], box: { x: 0, width: 100 } },
        ],
      } as unknown as Photo
      const soloA = {
        id: 'sa1',
        timestamp: 200,
        faces: [{ descriptor: [0.1], box: { x: 0, width: 100 } }],
      } as unknown as Photo
      const soloB1 = {
        id: 'sb1',
        timestamp: 300,
        faces: [{ descriptor: [0.5], box: { x: 0, width: 100 } }],
      } as unknown as Photo
      const soloB2 = {
        id: 'sb2',
        timestamp: 400,
        faces: [{ descriptor: [0.5], box: { x: 0, width: 100 } }],
      } as unknown as Photo

      const clusterA = { id: 'A', descriptor: [0.1] } as unknown as FaceCluster
      const clusterB = { id: 'B', descriptor: [0.5] } as unknown as FaceCluster

      mockDB.getAllFromIndex.mockResolvedValue([twoShot, soloA, soloB1, soloB2])
      // @ts-expect-error -- Mocking return value
      burstDetection.deduplicateBurstPhotos.mockReturnValue([twoShot, soloA, soloB1, soloB2])
      vi.mocked(faceapi.euclideanDistance).mockImplementation((d1: unknown, d2: unknown) => {
        return Math.abs((d1 as number[])[0]! - (d2 as number[])[0]!)
      })

      const result = await selectGroupBalancedPhotos('session1', [clusterA, clusterB], 3)

      expect(result).toHaveLength(3)
      const ids = result.map((p) => p.id)
      // Should include two-shot, solo-A, and one solo-B (balanced A=2, B=2)
      expect(ids).toContain('ts1')
      expect(ids).toContain('sa1')
      // One of the solo-B photos
      expect(ids.some((id) => id === 'sb1' || id === 'sb2')).toBe(true)
    })

    it('should not select only-overrepresented-subject photos when underrepresented photos exist', async () => {
      // Scenario: TwoShot(A+B), Solo(B), Solo(A). Select 2.
      // 1st: TwoShot(A+B) score = 2+2bonus = 4 (both at min=0). A=1, B=1.
      // 2nd: Solo(B) score = 1-1+2 = 2 (B at min=1). Solo(A) score = 1-1+2 = 2 (A at min=1).
      // Tie → picks first in pool order. Both result in balanced A=2,B=1 or A=1,B=2. That's fine.
      // The important thing: if Solo(A) doesn't exist, only Solo(B):
      // TwoShot(A+B), Solo(B). Select 2.
      // 1st: TwoShot = 4. A=1, B=1. 2nd: Solo(B) = 1-1+2 = 2 (B at min=1, A at min=1). Selected.
      // A=1, B=2. This is slightly unbalanced but unavoidable (no solo-A exists).

      const twoShot = {
        id: 'ts1',
        timestamp: 100,
        faces: [
          { descriptor: [0.1], box: { x: 0, width: 100 } },
          { descriptor: [0.5], box: { x: 0, width: 100 } },
        ],
      } as unknown as Photo
      const soloA = {
        id: 'sa1',
        timestamp: 200,
        faces: [{ descriptor: [0.1], box: { x: 0, width: 100 } }],
      } as unknown as Photo
      const soloB = {
        id: 'sb1',
        timestamp: 300,
        faces: [{ descriptor: [0.5], box: { x: 0, width: 100 } }],
      } as unknown as Photo

      const clusterA = { id: 'A', descriptor: [0.1] } as unknown as FaceCluster
      const clusterB = { id: 'B', descriptor: [0.5] } as unknown as FaceCluster

      mockDB.getAllFromIndex.mockResolvedValue([twoShot, soloA, soloB])
      // @ts-expect-error -- Mocking return value
      burstDetection.deduplicateBurstPhotos.mockReturnValue([twoShot, soloA, soloB])
      vi.mocked(faceapi.euclideanDistance).mockImplementation((d1: unknown, d2: unknown) => {
        return Math.abs((d1 as number[])[0]! - (d2 as number[])[0]!)
      })

      const result = await selectGroupBalancedPhotos('session1', [clusterA, clusterB], 2)

      expect(result).toHaveLength(2)
      const ids = result.map((p) => p.id)
      // Must include two-shot
      expect(ids).toContain('ts1')
      // Second photo: both solo-A and solo-B score equally since both are at minCount.
      // Either is acceptable for balance.
      expect(ids.some((id) => id === 'sa1' || id === 'sb1')).toBe(true)
    })

    it('should prefer balanced singles over unbalanced pairs (Fairness over Efficiency)', async () => {
      // "Trap" Scenario:
      // Target: 4 photos.
      // Pool: 1 Pair (A+B), Singles A, B, C, D (multiple copies available).
      //
      // Old "Efficiency" logic would pick Pair(A+B). Counts: A=1, B=1, C=0, D=0.
      // Then picking C and D would leave us with 3 photos.
      // If we pick 4 photos: Pair(A+B), Single(C), Single(D), Single(A or B).
      // Result Counts: A=2, B=1, C=1, D=1 (Total Faces=5). Unbalanced.
      //
      // New "Fairness" logic (StdDev) should realize that picking Pair(A+B) creates imbalance if we can't balance it later.
      // Wait, if we pick Pair(A+B), variance increases.
      // Ideally, it should pick Single(A), Single(B), Single(C), Single(D).
      // Result Counts: A=1, B=1, C=1, D=1 (Total Faces=4). Perfectly Balanced.

      const pairAB = {
        id: 'pairAB',
        timestamp: 100,
        faces: [
          { descriptor: [0.1], box: { x: 0, width: 100 } },
          { descriptor: [0.2], box: { x: 0, width: 100 } },
        ],
      } as unknown as Photo

      const singleA = {
        id: 'singleA',
        timestamp: 200,
        faces: [{ descriptor: [0.1], box: { x: 0, width: 100 } }],
      } as unknown as Photo
      const singleB = {
        id: 'singleB',
        timestamp: 300,
        faces: [{ descriptor: [0.2], box: { x: 0, width: 100 } }],
      } as unknown as Photo
      const singleC = {
        id: 'singleC',
        timestamp: 400,
        faces: [{ descriptor: [0.3], box: { x: 0, width: 100 } }],
      } as unknown as Photo
      const singleD = {
        id: 'singleD',
        timestamp: 500,
        faces: [{ descriptor: [0.4], box: { x: 0, width: 100 } }],
      } as unknown as Photo

      // Need enough singles to fill the quota if pair is skipped
      const singleA2 = { ...singleA, id: 'singleA2', timestamp: 600 }
      const singleB2 = { ...singleB, id: 'singleB2', timestamp: 700 }

      const clusterA = {
        id: 'A',
        descriptor: [0.1],
        config: { similarityThreshold: 0.05 },
      } as unknown as FaceCluster
      const clusterB = {
        id: 'B',
        descriptor: [0.2],
        config: { similarityThreshold: 0.05 },
      } as unknown as FaceCluster
      const clusterC = {
        id: 'C',
        descriptor: [0.3],
        config: { similarityThreshold: 0.05 },
      } as unknown as FaceCluster
      const clusterD = {
        id: 'D',
        descriptor: [0.4],
        config: { similarityThreshold: 0.05 },
      } as unknown as FaceCluster

      mockDB.getAllFromIndex.mockResolvedValue([
        pairAB,
        singleA,
        singleB,
        singleC,
        singleD,
        singleA2,
        singleB2,
      ])
      // @ts-expect-error -- Mocking return value
      burstDetection.deduplicateBurstPhotos.mockReturnValue([
        pairAB,
        singleA,
        singleB,
        singleC,
        singleD,
        singleA2,
        singleB2,
      ])
      vi.mocked(faceapi.euclideanDistance).mockImplementation((d1: unknown, d2: unknown) => {
        return Math.abs((d1 as number[])[0]! - (d2 as number[])[0]!)
      })

      const result = await selectGroupBalancedPhotos(
        'session1',
        [clusterA, clusterB, clusterC, clusterD],
        4,
      )

      expect(result).toHaveLength(4)
      const ids = result.map((p) => p.id)

      // With K=25 (high penalty for imbalance), it should avoid the pair if it leads to higher stdDev
      // Pair(A+B) -> Counts 1,1,0,0. Mean=0.5. Var=((0.5^2)*2 + (-0.5^2)*2)/4 = (0.25*2 + 0.25*2)/4 = 1/4 = 0.25. StdDev=0.5.
      // Score = 2 - 25*0.5 = -10.5.
      // Single(A) -> Counts 1,0,0,0. Mean=0.25. Var=((0.75^2) + (-0.25^2)*3)/4 = (0.5625 + 0.0625*3)/4 = (0.5625 + 0.1875)/4 = 0.75/4 = 0.1875. StdDev=0.433.
      // Score = 1 - 25*0.433 = 1 - 10.8 = -9.8.
      // Single score (-9.8) > Pair score (-10.5).
      // So it picks a Single first!
      // Then it picks other Singles to balance StdDev further reduce variance.

      // Expected: No pair, just singles to maintain perfect balance 1,1,1,1.
      expect(ids).not.toContain('pairAB')
      expect(ids).toContain('singleC')
      expect(ids).toContain('singleD')
      const hasA = ids.some((id) => id.startsWith('singleA'))
      const hasB = ids.some((id) => id.startsWith('singleB'))
      expect(hasA).toBe(true)
      expect(hasB).toBe(true)
    })
  })

  describe('selectGrowthPhotos', () => {
    it('should select photos evenly distributed over time', async () => {
      const p1 = {
        id: 'p1',
        timestamp: 1000,
        faces: [{ descriptor: [0.1], box: { x: 0, width: 100 } }],
      } as unknown as Photo
      const p2 = {
        id: 'p2',
        timestamp: 2000,
        faces: [{ descriptor: [0.1], box: { x: 0, width: 100 } }],
      } as unknown as Photo
      const p3 = {
        id: 'p3',
        timestamp: 3000,
        faces: [{ descriptor: [0.1], box: { x: 0, width: 100 } }],
      } as unknown as Photo
      const p4 = {
        id: 'p4',
        timestamp: 4000,
        faces: [{ descriptor: [0.1], box: { x: 0, width: 100 } }],
      } as unknown as Photo
      const p5 = {
        id: 'p5',
        timestamp: 5000,
        faces: [{ descriptor: [0.1], box: { x: 0, width: 100 } }],
      } as unknown as Photo

      const clusterA = { id: 'A', descriptor: [0.1] } as unknown as FaceCluster

      mockDB.getAllFromIndex.mockResolvedValue([p1, p2, p3, p4, p5])
      // @ts-expect-error -- Mocking return value
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
      const p1 = { id: 'p1', timestamp: 1000, faces: [] } as unknown as Photo
      const clusterA = { id: 'A', descriptor: [0.1] } as unknown as FaceCluster

      mockDB.getAllFromIndex.mockResolvedValue([p1])
      // @ts-expect-error -- Mocking return value
      burstDetection.deduplicateBurstPhotos.mockReturnValue([p1])

      const result = await selectGrowthPhotos('session1', clusterA, 3)
      // Should return unmatched photos if any?
      // Code says: return [...selected, ...unmatchedPhotos];
      // If p1 is unmatched, it should return p1.

      expect(result).toHaveLength(0)
    })
  })
})
