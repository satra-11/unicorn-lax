import * as faceapi from 'face-api.js'
import type { Photo, FaceCluster } from './types'
import { getDB, saveCluster, getAllClusters } from './db'

// Threshold for face similarity. 0.6 is standard for dlib/face-api.js
export const CLUSTER_THRESHOLD = 0.4

// Threshold for matching a new cluster centroid to an existing persisted cluster
const LABEL_CARRY_OVER_THRESHOLD = 0.4

export async function clusterFaces(sessionId: string): Promise<FaceCluster[]> {
  const db = await getDB()
  const photos = await db.getAllFromIndex('photos', 'by-session', sessionId)

  // 1. Load previously saved clusters
  let clusters = await getAllClusters()

  // 2. Identify all photo IDs in the current session
  const sessionPhotoIds = new Set(photos.map((p) => p.id))

  // 3. "Clean" existing clusters by removing photos from the current session
  //    This allows us to re-cluster them potentially into different groups if thresholds changed.
  //    However, we MUST keep "confirmed" photos if they are in this session?
  //    Actually, if a photo is "confirmed" in a cluster, it should probably stay there unless we are doing a full re-calc.
  //    For now, let's assume `clusterFaces` is run when opening the page or when requested,
  //    and it should primarily group *unassigned* faces or re-group if settings changed.
  //    If we want to respect "confirmed" faces, we should skip clustering for them.

  //    Let's refine:
  //    - If a photo has been "confirmed" manually by user into Cluster A, we should NOT move it.
  //    - If it was just auto-assigned, we can re-assign it.

  //    So, for each existing cluster:
  //      - Keep `photoIds` that are NOT in current session.
  //      - Keep `photoIds` that ARE in current session BUT are also in `confirmedPhotoIds`.
  //      - Remove `photoIds` that are in current session AND NOT confirmed.

  for (const cluster of clusters) {
    const confirmed = new Set(cluster.confirmedPhotoIds || [])
    cluster.photoIds = cluster.photoIds.filter((pid) => {
      // Keep if NOT in current session
      if (!sessionPhotoIds.has(pid)) return true
      // Keep if in current session AND confirmed
      if (confirmed.has(pid)) return true
      // Drop otherwise (it will be re-processed below)
      return false
    })
  }

  // Extract faces from photos in this session
  // We only want to cluster faces that are NOT already confirmed in some cluster.
  const facesToCluster: {
    descriptor: Float32Array
    photoId: string
    box: any
    thumbnail?: Blob
  }[] = []

  // Build a set of confirmed photo IDs across ALL clusters to skip them
  const allConfirmedPhotoIds = new Set<string>()
  for (const c of clusters) {
    if (c.confirmedPhotoIds) {
      c.confirmedPhotoIds.forEach((id) => allConfirmedPhotoIds.add(id))
    }
  }

  for (const photo of photos) {
    if (allConfirmedPhotoIds.has(photo.id)) continue // Skip confirmed photos

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

  console.log(`[Cluster] Processing ${facesToCluster.length} faces (excluding confirmed).`)

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
      // Create new cluster
      // Try to verify if this is actually a known person from OTHER sessions (already in clusters list)
      // But we already checked all clusters in the loop above.
      // So this is definitely a new face group *for the current constraints*.

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

  // Return only clusters that have at least one photo from THIS session
  // (to display in the UI for this session)
  const relevantClusters = clusters.filter((c) =>
    c.photoIds.some((pid) => sessionPhotoIds.has(pid)),
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

  // We need to perform the recalculation.
  // 1. Get DB
  // 2. Fetch all target photos
  // 3. Find the matching face in each photo (closest to current cluster descriptor)
  // 4. Average the descriptors

  const allDescriptors: Float32Array[] = []

  // We need to fetch photos. Since we don't have a direct `getPhoto` imported yet,
  // let's rely on standard logic or add it.
  // For now, to make progress, I will assume we can fetch them.
  // Since `photoIds` are unique, we might need a `getPhoto` in `db.ts`.
  // I will add `getPhoto` to `db.ts` in the next step.

  for (const photoId of targetPhotoIds) {
    // @ts-ignore - verify existence in db.ts later
    const photo = (await db.get('photos', photoId)) as Photo | undefined

    if (photo && photo.faces) {
      // Find the face that matches this cluster
      let bestFaceDesc: Float32Array | null = null
      let bestDist = Infinity

      for (const face of photo.faces) {
        const desc =
          face.descriptor instanceof Float32Array
            ? face.descriptor
            : new Float32Array(face.descriptor)

        const dist = faceapi.euclideanDistance(desc, cluster.descriptor)
        if (dist < CLUSTER_THRESHOLD && dist < bestDist) {
          bestDist = dist
          bestFaceDesc = desc
        }
      }

      if (bestFaceDesc) {
        allDescriptors.push(bestFaceDesc)
      }
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

function findExistingLabel(
  existingClusters: FaceCluster[],
  descriptor: Float32Array,
  currentIndex: number,
): string {
  const defaultLabel = `Person ${currentIndex + 1}`

  for (const existing of existingClusters) {
    const existingDesc =
      existing.descriptor instanceof Float32Array
        ? existing.descriptor
        : new Float32Array(existing.descriptor)
    const distance = faceapi.euclideanDistance(Array.from(descriptor), Array.from(existingDesc))
    if (distance < LABEL_CARRY_OVER_THRESHOLD) {
      return existing.label
    }
  }

  return defaultLabel
}

export async function getUnrecognizedPhotos(sessionId: string): Promise<Photo[]> {
  const db = await getDB()
  const photos = await db.getAllFromIndex('photos', 'by-session', sessionId)

  // Filter for photos that have no faces detected
  // unrecognized means: faces array is empty or undefined, OR noFaceMatch is true (though noFaceMatch might be used for logic elsewhere)
  return photos.filter((p) => !p.faces || p.faces.length === 0)
}
