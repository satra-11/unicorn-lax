import type { Photo, FaceCluster } from './types'
import { getDB } from './db'
import { CLUSTER_THRESHOLD } from './clustering'
import { deduplicateBurstPhotos } from './burst-detection'
import * as faceapi from 'face-api.js'

interface ScoredPhoto {
  photo: Photo
  subjects: string[]
  matchedFaces: NonNullable<Photo['faces']>
  matched: boolean
}

function matchPhotoToSubjects(
  photo: Photo,
  targetClusters: FaceCluster[],
): { subjects: string[]; matchedFaces: NonNullable<Photo['faces']>; matched: boolean } {
  if (!photo.faces || photo.faces.length === 0) {
    return { subjects: [], matchedFaces: [], matched: false }
  }

  const subjects = new Set<string>()
  const matchedFaces: NonNullable<Photo['faces']> = []

  for (const face of photo.faces) {
    let isMatch = false
    for (const cluster of targetClusters) {
      const threshold = cluster.config?.similarityThreshold ?? CLUSTER_THRESHOLD
      if (faceapi.euclideanDistance(face.descriptor, cluster.descriptor) < threshold) {
        subjects.add(cluster.id)
        isMatch = true
      }
    }
    if (isMatch) matchedFaces.push(face)
  }

  return { subjects: Array.from(subjects), matchedFaces, matched: subjects.size > 0 }
}

function buildScoredPhotos(allPhotos: Photo[], targetClusters: FaceCluster[]): ScoredPhoto[] {
  return allPhotos.map((photo) => {
    const { subjects, matchedFaces, matched } = matchPhotoToSubjects(photo, targetClusters)
    return { photo: { ...photo }, subjects, matchedFaces, matched }
  })
}

export interface SelectionWeights {
  smile: number // 0-1
  faceScore: number // 0-1 (Quality/Size)
  orientation: number // 0-1 (Looking at camera)
  center: number // 0-1 (Centering)
  blur: number // 0-1 (Sharpness)
  groupBalance: number // 0 (Solo) to 1 (Group)
}

export async function selectGroupBalancedPhotos(
  sessionId: string,
  targetClusters: FaceCluster[],
  count: number,
  weights: SelectionWeights = {
    smile: 0,
    faceScore: 0,
    orientation: 0,
    center: 0,
    blur: 0,
    groupBalance: 0.5, // Default to neutral/fairness
  },
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
  // 4. Incorporate Quality Scores (Smile, Blur, etc.)

  const selected: (typeof scoredPhotos)[0][] = []
  const subjectCounts = new Map<string, number>()
  targetClusters.forEach((c) => subjectCounts.set(c.id, 0))

  // Clone matched array to pick from
  const pool = [...matched]

  // Pre-calculate Quality Scores for efficiency
  // This score is constant for a photo regardless of selection state
  const photoQualityScores = new Map<string, number>()
  pool.forEach((img) => {
    let qScore = 0
    if (img.matchedFaces.length > 0) {
      // Average metrics across matched faces
      const avgSmile =
        img.matchedFaces.reduce((sum, f) => sum + (f.smileScore ?? 0), 0) / img.matchedFaces.length
      const avgPan =
        img.matchedFaces.reduce((sum, f) => sum + Math.abs(f.panScore ?? 0), 0) /
        img.matchedFaces.length
      // panScore of 0 is Front. We want 0. So score should be higher if pan is lower.
      // Let's use (1 - abs(pan)) as "Frontality" score.

      const avgFaceScore =
        img.matchedFaces.reduce((sum, f) => sum + (f.score ?? 0), 0) / img.matchedFaces.length

      // Center score: How close to center?
      // 0.5 is center X.
      const avgCenterX =
        img.matchedFaces.reduce(
          (sum, f) => sum + Math.abs((f.box.x + f.box.width / 2) / (img.photo.width || 1000) - 0.5),
          0,
        ) / img.matchedFaces.length
      // avgCenterX is distance from 0.5. Range 0 to 0.5.
      // We want distinct score. 1 - (dist * 2) => 1 at center, 0 at edge.

      const centerMetric = 1 - avgCenterX * 2
      const orientationMetric = 1 - avgPan // 1 is front, 0 is side (pan=1)

      qScore += avgSmile * weights.smile * 2 // Boost smile impact
      qScore += avgFaceScore * weights.faceScore
      qScore += orientationMetric * weights.orientation
      qScore += centerMetric * weights.center
    }

    // Blur is photo-level (usually)
    if (img.photo.blurScore !== undefined) {
      qScore += img.photo.blurScore * weights.blur * 2 // Boost blur impact
    }

    // Group/Solo Bias Score
    // weights.groupBalance: 0 (Solo) ... 0.5 (Neutral) ... 1 (Group)
    // Map to -1 ... 0 ... 1
    const bias = (weights.groupBalance - 0.5) * 2
    if (bias > 0) {
      // Prefer Group: Bonus for > 1 subject
      if (img.subjects.length > 1) qScore += bias * 2
    } else if (bias < 0) {
      // Prefer Solo: Bonus for == 1 subject (by subtracting bias which is negative)
      // Or simpler: Penalty for > 1
      if (img.subjects.length === 1) qScore -= bias * 2 // bias is neg, so this adds score
    }

    photoQualityScores.set(img.photo.id, qScore)
  })

  for (let i = 0; i < count; i++) {
    if (pool.length === 0) break

    let bestCandidateIndex = -1
    let maxScore = -Infinity
    const K = 25 // Weight for standard deviation penalty (high value for strict balance)
    const numSubjects = targetClusters.length

    for (let j = 0; j < pool.length; j++) {
      const candidate = pool[j]!
      const qualityScore = photoQualityScores.get(candidate.photo.id) || 0

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

      // Score = (Number of Faces) + (Quality Score) - (K * StdDev)
      // Base value is faces count (efficiency), modulated by quality and fairness.
      const score = candidate.subjects.length + qualityScore - K * stdDev

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
