import * as faceapi from 'face-api.js'
import type { Photo, FaceCluster } from './types'
import { getDB, saveCluster, getAllClusters, deleteCluster } from './db'

// Threshold for face similarity. 0.6 is standard for dlib/face-api.js
export const CLUSTER_THRESHOLD = 0.4

export async function clusterFaces(sessionId: string): Promise<FaceCluster[]> {
  const db = await getDB()
  const photos = await db.getAllFromIndex('photos', 'by-session', sessionId)

  // 1. Load previously saved clusters
  const clusters = await getAllClusters()

  // 2. Identify all photo IDs in the current session
  const sessionPhotoIds = new Set(photos.map((p) => p.id))

  // 3. Build a set of ALL photo IDs already assigned to a cluster.
  //    We do NOT re-cluster photos that are already in a cluster — this preserves
  //    user feedback and prevents regression where centroids shift causes
  //    previously-matched photos to split into new groups.
  //    Only truly new (unassigned) photos will be clustered.

  const allAssignedPhotoIds = new Set<string>()
  for (const c of clusters) {
    for (const pid of c.photoIds) {
      allAssignedPhotoIds.add(pid)
    }
    if (c.confirmedPhotoIds) {
      for (const pid of c.confirmedPhotoIds) {
        allAssignedPhotoIds.add(pid)
      }
    }
  }

  // Extract faces from photos in this session that are NOT already assigned to any cluster
  const facesToCluster: {
    descriptor: Float32Array
    photoId: string
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    box: any
    thumbnail?: Blob
  }[] = []

  for (const photo of photos) {
    if (allAssignedPhotoIds.has(photo.id)) continue // Skip already-assigned photos

    if (photo.faces) {
      for (const face of photo.faces) {
        const desc =
          face.descriptor instanceof Float32Array
            ? face.descriptor
            : new Float32Array(face.descriptor)

        facesToCluster.push({
          descriptor: desc,
          photoId: photo.id,
          box: face.box,
          thumbnail: face.thumbnail,
        })
      }
    }
  }

  const trainedClusters = clusters.filter((c) => !/^Person \d+$/.test(c.label))
  console.log(
    `[Cluster] Processing ${facesToCluster.length} faces against ${clusters.length} clusters (${trainedClusters.length} user-trained).`,
  )

  // 4. Match faces against clusters
  for (const face of facesToCluster) {
    let bestMatchIndex = -1
    let minDistance = Infinity

    // Compare with existing (and potentially new) clusters
    for (let i = 0; i < clusters.length; i++) {
      const cluster = clusters[i]!

      // Use cluster-specific threshold or default
      const threshold = cluster.config?.similarityThreshold ?? CLUSTER_THRESHOLD

      const distance = faceapi.euclideanDistance(
        Array.from(face.descriptor),
        Array.from(cluster.descriptor),
      )

      if (distance < threshold && distance < minDistance) {
        minDistance = distance
        bestMatchIndex = i
      }
    }

    if (bestMatchIndex !== -1) {
      // Add to existing cluster
      const matched = clusters[bestMatchIndex]!
      matched.photoIds.push(face.photoId)
      if (!matched.thumbnail && face.thumbnail) {
        matched.thumbnail = face.thumbnail
      }
    } else {
      // Log distances to trained clusters when no match found
      if (trainedClusters.length > 0) {
        const distances = trainedClusters.map((c) => ({
          label: c.label,
          distance: faceapi
            .euclideanDistance(Array.from(face.descriptor), Array.from(c.descriptor))
            .toFixed(3),
          threshold: (c.config?.similarityThreshold ?? CLUSTER_THRESHOLD).toFixed(2),
        }))
        console.log(`[Cluster] No match for face in photo ${face.photoId}:`, distances)
      }

      const newCluster: FaceCluster = {
        id: crypto.randomUUID(),
        label: `Person ${clusters.length + 1}`,
        descriptor: face.descriptor,
        photoIds: [face.photoId],
        thumbnail: face.thumbnail,
        config: { similarityThreshold: CLUSTER_THRESHOLD },
      }
      clusters.push(newCluster)
    }
  }

  // Sort clusters by size (descending)
  clusters.sort((a, b) => b.photoIds.length - a.photoIds.length)

  // Persist ALL clusters (updates and new ones)
  for (const cluster of clusters) {
    await saveCluster(cluster)
  }

  // Return clusters that are relevant to show in the UI:
  // 1. Clusters with at least one photo from THIS session (auto-matched or manually assigned)
  // 2. User-trained clusters (custom-named, non-default label) — shown even with 0 photos
  //    so users can manually move photos into them after re-upload
  const isUserTrained = (c: FaceCluster) => c.label && !/^Person \d+$/.test(c.label)

  const relevantClusters = clusters.filter(
    (c) => c.photoIds.some((pid) => sessionPhotoIds.has(pid)) || isUserTrained(c),
  )

  return relevantClusters
}

/**
 * Recalculates the cluster centroid (descriptor) based on confirmed photos.
 * If no photos are confirmed, it uses all associated photos.
 * This allows the "concept" of a person to evolve as the user provides feedback.
 */
export async function recalculateClusterCentroid(clusterId: string): Promise<void> {
  const db = await getDB()

  // Get the cluster
  // We need to implement getCluster in db.ts or just get all and find
  // For efficiency let's assume we can get all for now, or add getCluster later.
  // Using getAllClusters for now as it's available.
  const clusters = await getAllClusters()
  const cluster = clusters.find((c) => c.id === clusterId)

  if (!cluster) {
    console.error(`[Cluster] Cluster ${clusterId} not found for recalculation`)
    return
  }

  // Determine which photos to use for centroid calculation
  // Priority: Confirmed photos > All photos
  // Actually, "All photos" might include wrongly clustered ones, so maybe we should matches
  // ONLY if no confirmed photos exist?
  // Strategy:
  // 1. If confirmedPhotoIds has entries, use ONLY those faces. This "purifies" the cluster.
  // 2. If no confirmed IDs, keep current descriptor (or re-average all if needed, but current is likely average already).

  const targetPhotoIds =
    cluster.confirmedPhotoIds && cluster.confirmedPhotoIds.length > 0
      ? cluster.confirmedPhotoIds
      : cluster.photoIds

  if (targetPhotoIds.length === 0) return

  // Use cluster-specific threshold (Fix: was using hardcoded CLUSTER_THRESHOLD)
  const threshold = cluster.config?.similarityThreshold ?? CLUSTER_THRESHOLD

  // Fetch all target photos and their face descriptors
  const photoFaces: { photoId: string; descriptors: Float32Array[] }[] = []

  for (const photoId of targetPhotoIds) {
    const photo = (await db.get('photos', photoId)) as Photo | undefined

    if (photo && photo.faces) {
      const descriptors = photo.faces.map((face) =>
        face.descriptor instanceof Float32Array
          ? face.descriptor
          : new Float32Array(face.descriptor),
      )
      photoFaces.push({ photoId, descriptors })
    }
  }

  // Two-pass approach to avoid circular centroid reference:
  // Pass 1: Collect descriptors from single-face photos (unambiguous)
  //         to build a reliable preliminary centroid.
  // Pass 2: Use the preliminary centroid to pick the correct face
  //         from multi-face photos.

  const singleFaceDescriptors: Float32Array[] = []
  const multiFacePhotos: { photoId: string; descriptors: Float32Array[] }[] = []

  for (const pf of photoFaces) {
    if (pf.descriptors.length === 1 && pf.descriptors[0]) {
      singleFaceDescriptors.push(pf.descriptors[0])
    } else if (pf.descriptors.length > 1) {
      multiFacePhotos.push(pf)
    }
  }

  // Build preliminary centroid from single-face photos
  let preliminaryCentroid: Float32Array | null = null

  if (singleFaceDescriptors.length > 0) {
    const firstDesc = singleFaceDescriptors[0]!
    const numDims = firstDesc.length
    const mean = new Float32Array(numDims)
    for (const desc of singleFaceDescriptors) {
      for (let i = 0; i < numDims; i++) {
        mean[i] = (mean[i] ?? 0) + (desc[i] ?? 0)
      }
    }
    for (let i = 0; i < numDims; i++) {
      mean[i] = (mean[i] ?? 0) / singleFaceDescriptors.length
    }
    preliminaryCentroid = mean
  }

  // The reference centroid for multi-face disambiguation:
  // prefer preliminary centroid from single-face photos, fall back to current cluster descriptor
  const referenceCentroid = preliminaryCentroid ?? cluster.descriptor

  // Pass 2: Pick best face from multi-face photos using the reference centroid
  const allDescriptors: Float32Array[] = [...singleFaceDescriptors]

  for (const pf of multiFacePhotos) {
    let bestFaceDesc: Float32Array | null = null
    let bestDist = Infinity

    for (const desc of pf.descriptors) {
      const dist = faceapi.euclideanDistance(Array.from(desc), Array.from(referenceCentroid))
      if (dist < threshold && dist < bestDist) {
        bestDist = dist
        bestFaceDesc = desc
      }
    }

    if (bestFaceDesc) {
      allDescriptors.push(bestFaceDesc)
    }
  }

  if (allDescriptors.length > 0) {
    // Calculate mean descriptor
    const firstDesc = allDescriptors[0]
    if (!firstDesc) return

    const numDims = firstDesc.length
    const mean = new Float32Array(numDims)

    for (const desc of allDescriptors) {
      for (let i = 0; i < numDims; i++) {
        const val = desc[i]
        const current = mean[i]
        if (val !== undefined && current !== undefined) {
          mean[i] = current + val
        }
      }
    }

    for (let i = 0; i < numDims; i++) {
      const val = mean[i]
      if (val !== undefined) {
        mean[i] = val / allDescriptors.length
      }
    }

    // Update cluster
    cluster.descriptor = mean
    await saveCluster(cluster)
    console.log(
      `[Cluster] Recalculated centroid for ${cluster.label} using ${allDescriptors.length} faces.`,
    )
  }
}

export async function getUnrecognizedPhotos(sessionId: string): Promise<Photo[]> {
  const db = await getDB()
  const photos = await db.getAllFromIndex('photos', 'by-session', sessionId)

  // Filter for photos that have no faces detected
  // unrecognized means: faces array is empty or undefined, OR noFaceMatch is true (though noFaceMatch might be used for logic elsewhere)
  return photos.filter((p) => !p.faces || p.faces.length === 0)
}

/**
 * Moves a photo from one cluster to another and recalculates both centroids.
 * This acts as a feedback loop: explicitly confirming the photo belongs to the target
 * and does NOT belong to the source.
 */
export async function movePhotoToCluster(
  photoId: string,
  sourceClusterId: string,
  targetClusterId: string,
): Promise<void> {
  const clusters = await getAllClusters()
  const source = clusters.find((c) => c.id === sourceClusterId)
  const target = clusters.find((c) => c.id === targetClusterId)

  if (!source || !target) {
    throw new Error('Source or target cluster not found')
  }

  // 1. Remove from source
  source.photoIds = source.photoIds.filter((id) => id !== photoId)
  if (source.confirmedPhotoIds) {
    source.confirmedPhotoIds = source.confirmedPhotoIds.filter((id) => id !== photoId)
  }

  // 2. Add to target (and confirm it)
  // Ensure we don't duplicate
  if (!target.photoIds.includes(photoId)) {
    target.photoIds.push(photoId)
  }
  if (!target.confirmedPhotoIds) target.confirmedPhotoIds = []
  if (!target.confirmedPhotoIds.includes(photoId)) {
    target.confirmedPhotoIds.push(photoId)
  }

  // 3. Save changes
  await saveCluster(source)
  await saveCluster(target)

  // 4. Recalculate centroids (Feedback Loop)
  // We await these sequentially to ensure data consistency, though parallel matches are possible.
  await recalculateClusterCentroid(source.id)
  await recalculateClusterCentroid(target.id)

  console.log(
    `[Cluster] Moved photo ${photoId} from ${source.label} to ${target.label} and updated centroids.`,
  )
}

// Threshold for suggesting a merge. Pairs with distance between
// CLUSTER_THRESHOLD and this value are considered "similar enough to ask".
export const MERGE_SUGGESTION_THRESHOLD = 0.44

export interface SimilarClusterPair {
  clusterA: FaceCluster
  clusterB: FaceCluster
  distance: number
}

/**
 * Find pairs of clusters that are similar enough to potentially be the same person,
 * but not similar enough to have been auto-merged during clustering.
 * Returns pairs sorted by distance (closest first).
 */
export function findSimilarClusterPairs(clusters: FaceCluster[]): SimilarClusterPair[] {
  const pairs: SimilarClusterPair[] = []

  // Only consider real clusters (not unrecognized, with photos)
  const realClusters = clusters.filter(
    (c) => c.id !== 'unrecognized' && c.photoIds.length > 0 && c.descriptor.length > 0,
  )

  for (let i = 0; i < realClusters.length; i++) {
    for (let j = i + 1; j < realClusters.length; j++) {
      const a = realClusters[i]!
      const b = realClusters[j]!

      const distance = faceapi.euclideanDistance(Array.from(a.descriptor), Array.from(b.descriptor))

      // Within the "maybe same person" range
      const lowerBound = Math.max(
        a.config?.similarityThreshold ?? CLUSTER_THRESHOLD,
        b.config?.similarityThreshold ?? CLUSTER_THRESHOLD,
      )

      if (distance >= lowerBound && distance < MERGE_SUGGESTION_THRESHOLD) {
        pairs.push({ clusterA: a, clusterB: b, distance })
      }
    }
  }

  // Sort by distance ascending (most similar first)
  pairs.sort((a, b) => a.distance - b.distance)

  return pairs
}

/**
 * Merges two clusters into one. The "keep" cluster absorbs the "remove" cluster.
 * - PhotoIds and confirmedPhotoIds are combined
 * - Descriptor is averaged
 * - Label preference: user-given name over auto-generated "Person X"
 * - The "remove" cluster is deleted from DB
 */
export async function mergeClusters(keepClusterId: string, removeClusterId: string): Promise<void> {
  const clusters = await getAllClusters()
  const keep = clusters.find((c) => c.id === keepClusterId)
  const remove = clusters.find((c) => c.id === removeClusterId)

  if (!keep || !remove) {
    throw new Error('One or both clusters not found for merge')
  }

  const isAutoLabel = (label: string) => /^Person \d+$/.test(label)

  // Prefer user-given label
  if (isAutoLabel(keep.label) && !isAutoLabel(remove.label)) {
    keep.label = remove.label
  }

  // Merge photo IDs (deduplicated)
  const mergedPhotoIds = new Set([...keep.photoIds, ...remove.photoIds])
  keep.photoIds = Array.from(mergedPhotoIds)

  // Merge confirmed photo IDs
  const mergedConfirmed = new Set([
    ...(keep.confirmedPhotoIds ?? []),
    ...(remove.confirmedPhotoIds ?? []),
  ])
  keep.confirmedPhotoIds = Array.from(mergedConfirmed)

  // Keep the thumbnail from whichever has one
  if (!keep.thumbnail && remove.thumbnail) {
    keep.thumbnail = remove.thumbnail
  }

  // Average the descriptors
  if (keep.descriptor.length > 0 && remove.descriptor.length > 0) {
    const numDims = keep.descriptor.length
    const mean = new Float32Array(numDims)
    for (let i = 0; i < numDims; i++) {
      mean[i] = ((keep.descriptor[i] ?? 0) + (remove.descriptor[i] ?? 0)) / 2
    }
    keep.descriptor = mean
  }

  // Save the merged cluster and delete the removed one
  await saveCluster(keep)
  await deleteCluster(remove.id)

  console.log(
    `[Cluster] Merged "${remove.label}" into "${keep.label}". Total photos: ${keep.photoIds.length}`,
  )
}
