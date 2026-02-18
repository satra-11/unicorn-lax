import type { Photo, FaceCluster } from './types'
import { getDB } from './db'
import { CLUSTER_THRESHOLD } from './clustering'
import { deduplicateBurstPhotos } from './burst-detection'
import * as faceapi from 'face-api.js'

interface ScoredPhoto {
  photo: Photo
  subjects: string[]
  matched: boolean
}

function matchPhotoToSubjects(
  photo: Photo,
  targetClusters: FaceCluster[],
): { subjects: string[]; matched: boolean } {
  if (!photo.faces || photo.faces.length === 0) {
    return { subjects: [], matched: false }
  }

  const subjects = new Set<string>()
  for (const face of photo.faces) {
    for (const cluster of targetClusters) {
      const threshold = cluster.config?.similarityThreshold ?? CLUSTER_THRESHOLD
      if (faceapi.euclideanDistance(face.descriptor, cluster.descriptor) < threshold) {
        subjects.add(cluster.id)
      }
    }
  }

  return { subjects: Array.from(subjects), matched: subjects.size > 0 }
}

function buildScoredPhotos(allPhotos: Photo[], targetClusters: FaceCluster[]): ScoredPhoto[] {
  return allPhotos.map((photo) => {
    const { subjects, matched } = matchPhotoToSubjects(photo, targetClusters)
    return { photo: { ...photo }, subjects, matched }
  })
}

export async function selectGroupBalancedPhotos(
  sessionId: string,
  targetClusters: FaceCluster[],
  count: number,
): Promise<Photo[]> {
  const db = await getDB()
  const allPhotos = await db.getAllFromIndex('photos', 'by-session', sessionId)

  // Deduplicate burst photos before scoring
  const deduplicated = deduplicateBurstPhotos(allPhotos, targetClusters)

  const scoredPhotos = buildScoredPhotos(deduplicated, targetClusters)

  if (scoredPhotos.length === 0) return []

  const matched = scoredPhotos.filter((p) => p.matched)

  // If we have fewer matched photos than requested, return all of them
  if (matched.length <= count) {
    return matched.map((p) => p.photo)
  }

  // Greedy selection for Group Balance:
  // 1. Prioritize photos with the most target subjects (highest initial score)
  // 2. Maintain a count of how many times each subject has been selected
  // 3. Iteratively select photos that help balance the subject counts

  const selected: (typeof scoredPhotos)[0][] = []
  const subjectCounts = new Map<string, number>()
  targetClusters.forEach((c) => subjectCounts.set(c.id, 0))

  // Clone matched array to pick from
  const pool = [...matched]

  for (let i = 0; i < count; i++) {
    if (pool.length === 0) break

    // Find the minimum subject count to prioritize underrepresented subjects
    // const minCount = Math.min(...Array.from(subjectCounts.values()))

    let bestCandidateIndex = -1
    let maxScore = -Infinity
    const K = 25 // Weight for standard deviation penalty (high value for strict balance)
    const numSubjects = targetClusters.length

    for (let j = 0; j < pool.length; j++) {
      const candidate = pool[j]!

      // Calculate potential new counts if this candidate is selected
      const tempCounts = new Map(subjectCounts)
      candidate.subjects.forEach((subId) => {
        tempCounts.set(subId, (tempCounts.get(subId) || 0) + 1)
      })

      const newCounts = Array.from(tempCounts.values())

      // Calculate Standard Deviation of the new counts
      const mean = newCounts.reduce((a, b) => a + b, 0) / numSubjects
      const variance = newCounts.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / numSubjects
      const stdDev = Math.sqrt(variance)

      // Score = (Number of Faces) - (K * StdDev)
      // We want to maximize faces while drastically minimizing imbalance (StdDev).
      const score = candidate.subjects.length - K * stdDev



      if (score > maxScore) {
        maxScore = score
        bestCandidateIndex = j
      }
    }

    if (bestCandidateIndex !== -1) {
      const best = pool[bestCandidateIndex]!
      selected.push(best)

      // Update subject counts
      best.subjects.forEach((subId) => {
        subjectCounts.set(subId, (subjectCounts.get(subId) || 0) + 1)
      })

      // Remove from pool
      pool.splice(bestCandidateIndex, 1)
    }
  }

  // Sort selected photos by time for the album
  selected.sort((a, b) => a.photo.timestamp - b.photo.timestamp)

  return selected.map((p) => p.photo)
}

export async function selectGrowthPhotos(
  sessionId: string,
  targetCluster: FaceCluster,
  count: number,
): Promise<Photo[]> {
  const db = await getDB()
  const allPhotos = await db.getAllFromIndex('photos', 'by-session', sessionId)

  // Deduplicate burst photos before scoring
  const deduplicated = deduplicateBurstPhotos(allPhotos, [targetCluster])

  const scoredPhotos = buildScoredPhotos(deduplicated, [targetCluster])

  scoredPhotos.sort((a, b) => a.photo.timestamp - b.photo.timestamp)

  if (scoredPhotos.length === 0) return []

  const matched = scoredPhotos.filter((p) => p.matched)
  // We no longer include unmatched photos (faces not detected or other people)
  // const unmatched = scoredPhotos.filter((p) => !p.matched)

  const selected: Photo[] = []

  if (matched.length > 0) {
    const startTime = matched[0]!.photo.timestamp
    const endTime = matched[matched.length - 1]!.photo.timestamp
    const duration = endTime - startTime
    const interval = duration / count

    for (let i = 0; i < count; i++) {
      const bucketStart = startTime + i * interval
      const bucketEnd = bucketStart + interval

      const isLastBucket = i === count - 1
      const bucketPhotos = matched.filter(
        (p) =>
          p.photo.timestamp >= bucketStart &&
          (isLastBucket ? p.photo.timestamp <= bucketEnd : p.photo.timestamp < bucketEnd),
      )

      if (bucketPhotos.length > 0) {
        const bucketCenter = bucketStart + interval / 2

        const best = bucketPhotos.reduce((prev, curr) =>
          Math.abs(curr.photo.timestamp - bucketCenter) <
          Math.abs(prev.photo.timestamp - bucketCenter)
            ? curr
            : prev,
        )

        selected.push(best.photo)
      }
    }
  }

  // const unmatchedPhotos = unmatched.map((p) => p.photo)
  // return [...selected, ...unmatchedPhotos]
  return selected
}
