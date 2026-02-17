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
    return { photo: { ...photo, noFaceMatch: !matched }, subjects, matched }
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

    // Calculate dynamic score for each candidate in the pool
    // Dynamic Score = Base Score (number of subjects) - Penalty (subjects already selected)
    // We want to pick photos that contain subjects with LOW current counts.

    let bestCandidateIndex = -1
    let maxScore = -Infinity

    for (let j = 0; j < pool.length; j++) {
      const candidate = pool[j]!
      let score = 0

      // Base score: +1 for each target subject in the photo
      // Penalty: -1 * current_count for each subject
      // This makes photos with "rare" subjects more valuable.
      candidate.subjects.forEach((subId) => {
        score += 1
        score -= subjectCounts.get(subId) || 0
      })

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
  const unmatched = scoredPhotos.filter((p) => !p.matched)

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

  const unmatchedPhotos = unmatched.map((p) => p.photo)

  return [...selected, ...unmatchedPhotos]
}
