import { describe, it, expect, vi, beforeEach } from 'vitest'
import { clusterFaces } from './clustering'
import * as db from './db'
import * as faceapi from 'face-api.js'

// Mock dependencies
vi.mock('./db')
vi.mock('face-api.js', () => ({
  euclideanDistance: vi.fn(),
}))

describe('clustering', () => {
  const mockDB = {
    getAllFromIndex: vi.fn(),
    getAll: vi.fn(),
    put: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    // @ts-ignore
    db.getDB.mockResolvedValue(mockDB)
    // @ts-ignore
    db.getAllClusters.mockResolvedValue([])
    // @ts-ignore
    db.saveCluster.mockResolvedValue(undefined)
  })

  describe('clusterFaces', () => {
    it('should create new clusters for unique faces', async () => {
      const p1 = { id: 'p1', faces: [{ descriptor: [0.1], box: {} }] } as any
      const p2 = { id: 'p2', faces: [{ descriptor: [0.9], box: {} }] } as any // Far from p1

      mockDB.getAllFromIndex.mockResolvedValue([p1, p2])

      // Mock euclideanDistance
      vi.mocked(faceapi.euclideanDistance).mockImplementation((d1, d2) => {
        // @ts-ignore
        return Math.abs(d1[0] - d2[0])
      })

      // Threshold default 0.4
      // p1 vs p2 dist 0.8 -> new cluster

      const result = await clusterFaces('session1')

      expect(result).toHaveLength(2)
      expect(result[0]!.photoIds).toContain('p1') // Sort order might vary by size, both 1
      expect(result[1]!.photoIds).toContain('p2') // But distinct

      expect(db.saveCluster).toHaveBeenCalledTimes(2)
    })

    it('should group similar faces', async () => {
      const p1 = { id: 'p1', faces: [{ descriptor: [0.1], box: {} }] } as any
      const p2 = { id: 'p2', faces: [{ descriptor: [0.15], box: {} }] } as any // Close to p1

      mockDB.getAllFromIndex.mockResolvedValue([p1, p2])
      vi.mocked(faceapi.euclideanDistance).mockImplementation((d1, d2) => {
        // @ts-ignore
        return Math.abs(d1[0] - d2[0])
      })

      const result = await clusterFaces('session1')

      // Should be 1 cluster
      expect(result).toHaveLength(1)
      expect(result[0]!.photoIds).toHaveLength(2)
      expect(result[0]!.photoIds).toContain('p1')
      expect(result[0]!.photoIds).toContain('p2')
    })

    it('should respect existing clusters', async () => {
      const existingCluster = {
        id: 'c1',
        label: 'Person 1',
        descriptor: [0.1],
        photoIds: ['old1'],
        config: { similarityThreshold: 0.4 },
      }
      // @ts-ignore
      db.getAllClusters.mockResolvedValue([existingCluster])

      const p1 = { id: 'p1', faces: [{ descriptor: [0.15], box: {} }] } as any

      mockDB.getAllFromIndex.mockResolvedValue([p1])
      vi.mocked(faceapi.euclideanDistance).mockImplementation((d1, d2) => {
        // @ts-ignore
        return Math.abs(d1[0] - d2[0])
      })

      const result = await clusterFaces('session1')

      expect(result).toHaveLength(1)
      expect(result[0]!.id).toBe('c1')
      expect(result[0]!.photoIds).toContain('p1')
      // Should keep old1 ideally, but logic filters out non-session?
      // Logic says:
      /*
        cluster.photoIds = cluster.photoIds.filter(pid => {
          if (!sessionPhotoIds.has(pid)) return true;
          ...
        */
      // old1 is not in session, so it should be kept.
      expect(result[0]!.photoIds).toContain('old1')
    })
  })
})
