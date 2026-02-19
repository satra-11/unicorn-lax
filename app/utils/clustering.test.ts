import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  clusterFaces,
  findSimilarClusterPairs,
  mergeClusters,
  CLUSTER_THRESHOLD,
} from './clustering'
import * as db from './db'
import * as faceapi from 'face-api.js'
import type { Photo, FaceCluster } from './types'

// Mock dependencies
vi.mock('./db', () => ({
  getDB: vi.fn(),
  getAllClusters: vi.fn(),
  saveCluster: vi.fn(),
  deleteCluster: vi.fn(),
}))

vi.mock('face-api.js', () => ({
  euclideanDistance: vi.fn(),
}))

describe('clustering', () => {
  const mockDB = {
    getAllFromIndex: vi.fn(),
    getAll: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    // @ts-expect-error -- Mocking specific method
    db.getDB.mockResolvedValue(mockDB)
    // @ts-expect-error -- Mocking specific method
    db.getAllClusters.mockResolvedValue([])
    // @ts-expect-error -- Mocking specific method
    db.saveCluster.mockResolvedValue(undefined)
    // @ts-expect-error -- Mocking specific method
    db.deleteCluster.mockResolvedValue(undefined)
  })

  describe('clusterFaces', () => {
    it('should create new clusters for unique faces with "人物" label', async () => {
      const p1 = { id: 'p1', faces: [{ descriptor: [0.1], box: {} }] } as unknown as Photo
      const p2 = { id: 'p2', faces: [{ descriptor: [0.9], box: {} }] } as unknown as Photo // Far from p1

      mockDB.getAllFromIndex.mockResolvedValue([p1, p2])

      // Mock euclideanDistance
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(faceapi.euclideanDistance as any).mockImplementation((d1: any, d2: any) => {
        return Math.abs(d1[0] - d2[0])
      })

      // Threshold default 0.4
      // p1 vs p2 dist 0.8 -> new cluster

      const result = await clusterFaces('session1')

      expect(result).toHaveLength(2)
      expect(result[0]!.photoIds).toContain('p1')
      expect(result[0]!.label).toMatch(/^人物 \d+$/)
      expect(result[1]!.photoIds).toContain('p2')
      expect(result[1]!.label).toMatch(/^人物 \d+$/)

      expect(db.saveCluster).toHaveBeenCalledTimes(2)
    })

    it('should group similar faces', async () => {
      const p1 = { id: 'p1', faces: [{ descriptor: [0.1], box: {} }] } as unknown as Photo
      const p2 = { id: 'p2', faces: [{ descriptor: [0.15], box: {} }] } as unknown as Photo // Close to p1

      mockDB.getAllFromIndex.mockResolvedValue([p1, p2])
      mockDB.getAllFromIndex.mockResolvedValue([p1, p2])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(faceapi.euclideanDistance as any).mockImplementation((d1: any, d2: any) => {
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
      // @ts-expect-error -- Mocking specific method
      db.getAllClusters.mockResolvedValue([existingCluster])

      const p1 = { id: 'p1', faces: [{ descriptor: [0.15], box: {} }] } as unknown as Photo

      mockDB.getAllFromIndex.mockResolvedValue([p1])
      mockDB.getAllFromIndex.mockResolvedValue([p1])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(faceapi.euclideanDistance as any).mockImplementation((d1: any, d2: any) => {
        return Math.abs(d1[0] - d2[0])
      })

      const result = await clusterFaces('session1')

      expect(result).toHaveLength(1)
      expect(result[0]!.id).toBe('c1')
      expect(result[0]!.photoIds).toContain('p1')
      // old1 is not in session, so it should be kept.
      expect(result[0]!.photoIds).toContain('old1')
    })
  })

  describe('findSimilarClusterPairs', () => {
    it('should find pairs within the suggestion range', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(faceapi.euclideanDistance as any).mockReturnValue(0.42) // Between 0.4 and 0.44

      const clusterA: FaceCluster = {
        id: 'a',
        label: 'Person 1',
        descriptor: new Float32Array([0.1]),
        photoIds: ['p1'],
        config: { similarityThreshold: CLUSTER_THRESHOLD },
      }
      const clusterB: FaceCluster = {
        id: 'b',
        label: 'Person 2',
        descriptor: new Float32Array([0.5]),
        photoIds: ['p2'],
        config: { similarityThreshold: CLUSTER_THRESHOLD },
      }

      const pairs = findSimilarClusterPairs([clusterA, clusterB])

      expect(pairs).toHaveLength(1)
      expect(pairs[0]!.clusterA.id).toBe('a')
      expect(pairs[0]!.clusterB.id).toBe('b')
      expect(pairs[0]!.distance).toBe(0.42)
    })

    it('should not include pairs outside the suggestion range', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(faceapi.euclideanDistance as any).mockReturnValue(0.7) // Above 0.44

      const clusterA: FaceCluster = {
        id: 'a',
        label: 'Person 1',
        descriptor: new Float32Array([0.1]),
        photoIds: ['p1'],
      }
      const clusterB: FaceCluster = {
        id: 'b',
        label: 'Person 2',
        descriptor: new Float32Array([0.9]),
        photoIds: ['p2'],
      }

      const pairs = findSimilarClusterPairs([clusterA, clusterB])
      expect(pairs).toHaveLength(0)
    })

    it('should exclude unrecognized and empty clusters', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(faceapi.euclideanDistance as any).mockReturnValue(0.42)

      const clusterA: FaceCluster = {
        id: 'unrecognized',
        label: 'Unrecognized',
        descriptor: new Float32Array([0.1]),
        photoIds: ['p1'],
      }
      const clusterB: FaceCluster = {
        id: 'b',
        label: 'Person 2',
        descriptor: new Float32Array([0.5]),
        photoIds: ['p2'],
      }
      const clusterEmpty: FaceCluster = {
        id: 'c',
        label: 'Person 3',
        descriptor: new Float32Array([0.3]),
        photoIds: [],
      }

      const pairs = findSimilarClusterPairs([clusterA, clusterB, clusterEmpty])
      expect(pairs).toHaveLength(0)
    })

    it('should sort pairs by distance ascending', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(faceapi.euclideanDistance as any)
        .mockReturnValueOnce(0.43)
        .mockReturnValueOnce(0.41)
        .mockReturnValueOnce(0.42)

      const clusters: FaceCluster[] = [
        { id: 'a', label: 'P1', descriptor: new Float32Array([0.1]), photoIds: ['p1'] },
        { id: 'b', label: 'P2', descriptor: new Float32Array([0.2]), photoIds: ['p2'] },
        { id: 'c', label: 'P3', descriptor: new Float32Array([0.3]), photoIds: ['p3'] },
      ]

      const pairs = findSimilarClusterPairs(clusters)

      expect(pairs).toHaveLength(3)
      expect(pairs[0]!.distance).toBe(0.41)
      expect(pairs[1]!.distance).toBe(0.42)
      expect(pairs[2]!.distance).toBe(0.43)
    })
  })

  describe('mergeClusters', () => {
    it('should merge photoIds and delete the removed cluster', async () => {
      const keep: FaceCluster = {
        id: 'keep',
        label: 'Person 1',
        descriptor: new Float32Array([0.1, 0.2]),
        photoIds: ['p1', 'p2'],
      }
      const remove: FaceCluster = {
        id: 'remove',
        label: 'Person 2',
        descriptor: new Float32Array([0.3, 0.4]),
        photoIds: ['p3', 'p4'],
      }
      // @ts-expect-error -- Mocking specific method
      db.getAllClusters.mockResolvedValue([keep, remove])

      await mergeClusters('keep', 'remove')

      expect(db.saveCluster).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'keep',
          photoIds: expect.arrayContaining(['p1', 'p2', 'p3', 'p4']),
        }),
      )
      expect(db.deleteCluster).toHaveBeenCalledWith('remove')
    })

    it('should prefer user-given label over auto-generated', async () => {
      const keep: FaceCluster = {
        id: 'keep',
        label: '人物 1', // auto-generated
        descriptor: new Float32Array([0.1]),
        photoIds: ['p1'],
      }
      const remove: FaceCluster = {
        id: 'remove',
        label: 'Taro', // user-given
        descriptor: new Float32Array([0.2]),
        photoIds: ['p2'],
      }
      // @ts-expect-error -- Mocking specific method
      db.getAllClusters.mockResolvedValue([keep, remove])

      await mergeClusters('keep', 'remove')

      expect(db.saveCluster).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'keep',
          label: 'Taro',
        }),
      )
    })

    it('should throw if cluster not found', async () => {
      // @ts-expect-error -- Mocking specific method
      db.getAllClusters.mockResolvedValue([])

      await expect(mergeClusters('a', 'b')).rejects.toThrow(
        'One or both clusters not found for merge',
      )
    })
  })
})
