import { describe, it, expect, vi, beforeEach } from 'vitest'
import { exportDatabase, importDatabase } from './db'

// Mock IDB
const mockDB = {
  getAll: vi.fn(),
  put: vi.fn(),
  clear: vi.fn(),
  count: vi.fn(),
}

vi.mock('idb', () => ({
  openDB: vi.fn(() => Promise.resolve(mockDB)),
}))

describe('Backup Utils', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Mock global fetch

    global.fetch = vi.fn((_url: unknown) =>
      Promise.resolve({
        blob: () => Promise.resolve(new Blob(['mock-blob-content'])),
      } as unknown as Response),
    )
  })

  it('exportDatabase should serialize data correctly', async () => {
    const mockPhotos = [{ id: 'p1', thumbnail: new Blob(['data'], { type: 'image/jpeg' }) }]
    const mockSessions = [{ id: 's1' }]
    const mockClusters = [{ id: 'c1', descriptor: new Float32Array([0.1, 0.2]) }]

    mockDB.getAll.mockImplementation((store: string) => {
      if (store === 'photos') return Promise.resolve(mockPhotos)
      if (store === 'sessions') return Promise.resolve(mockSessions)
      if (store === 'clusters') return Promise.resolve(mockClusters)
      return Promise.resolve([])
    })

    const json = await exportDatabase()
    const data = JSON.parse(json)

    expect(data.version).toBe(1)
    expect(data.sessions).toEqual(mockSessions)
    // Blob should be serialized to base64 string (data url)
    expect(data.photos[0].thumbnail).toContain('data:image/jpeg;base64,')
    // Float32Array should be array
    expect(Array.isArray(data.clusters[0].descriptor)).toBe(true)
    expect(data.clusters[0].descriptor).toEqual([0.10000000149011612, 0.20000000298023224]) // Float precision
  })

  it('importDatabase should restore data correctly', async () => {
    const mockExportedData = {
      version: 1,
      photos: [{ id: 'p1', thumbnail: 'data:image/png;base64,fakebase64' }],
      sessions: [{ id: 's1' }],
      clusters: [{ id: 'c1', descriptor: [0.1, 0.2] }],
    }
    const jsonStr = JSON.stringify(mockExportedData)

    await importDatabase(jsonStr)

    // Verify puts
    expect(mockDB.put).toHaveBeenCalledTimes(3) // 1 session, 1 photo, 1 cluster

    // Check Photo restoration
    const photoCall = mockDB.put.mock.calls.find((c: unknown[]) => c[0] === 'photos')
    expect(photoCall).toBeDefined()
    if (photoCall) {
      const photo = photoCall[1] as { thumbnail: Blob }
      expect(photo.thumbnail).toBeInstanceOf(Blob)
      // Check MIME type if possible (happy-dom Blob implementation details vary, but let's assume it keeps type)
      expect(photo.thumbnail.type).toBe('image/png') // Manual parsing now correctly extracts type
    }
  })

  it('should preserve MIME types and face thumbnails', async () => {
    // Mock with explicit MIME type in Data URL
    // const dataUrl = 'data:image/png;base64,...' // Unused

    const mockPhotos = [
      {
        id: 'p2',
        thumbnail: new Blob(['png data'], { type: 'image/png' }),
        faces: [
          {
            descriptor: new Float32Array([0.1]),
            box: { x: 0, y: 0, width: 10, height: 10 },
            thumbnail: new Blob(['face data'], { type: 'image/jpeg' }),
          },
        ],
      },
    ]

    mockDB.getAll.mockImplementation((store: string) => {
      if (store === 'photos') return Promise.resolve(mockPhotos)
      return Promise.resolve([])
    })

    // We need to allow FileReader to work.
    // The current mock for blobToBase64 uses FileReader.
    // We need to ensure FileReader mock or implementation works with Blob.
    // In node env/vitest with happy-dom, FileReader should work.
    // But we need to ensure readAsDataURL produces correct data url with mime type.

    // Let's rely on our mock global fetch for base64ToBlob to return blob with type if we can control it.
    // But my base64ToBlob implementation now does MANUAL parsing first!
    // So it doesn't use fetch if data url is valid. This is great for testing!

    const json = await exportDatabase()
    const data = JSON.parse(json)

    expect(data.photos[0].thumbnail).toContain('data:image/png;base64,')
    expect(data.photos[0].faces[0].thumbnail).toContain('data:image/jpeg;base64,')

    // Now import
    await importDatabase(json)

    const photoPut = mockDB.put.mock.calls.find(
      (c: unknown[]) => c[0] === 'photos' && (c[1] as { id: string }).id === 'p2',
    )
    expect(photoPut).toBeDefined()
    if (photoPut) {
      expect(photoPut[1].thumbnail.type).toBe('image/png')
      expect(photoPut[1].faces[0].thumbnail.type).toBe('image/jpeg')
    }
  })
})
