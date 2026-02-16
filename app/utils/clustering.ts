import * as faceapi from 'face-api.js';
import type { Photo, FaceCluster } from './types';
import { getDB, saveCluster, getAllClusters } from './db';

// Threshold for face similarity. 0.6 is standard for dlib/face-api.js
export const CLUSTER_THRESHOLD = 0.4;

// Threshold for matching a new cluster centroid to an existing persisted cluster
const LABEL_CARRY_OVER_THRESHOLD = 0.4;

export async function clusterFaces(sessionId: string): Promise<FaceCluster[]> {
  const db = await getDB();
  const photos = await db.getAllFromIndex('photos', 'by-session', sessionId);
  
  // Load previously saved clusters to carry over user-assigned labels
  const existingClusters = await getAllClusters();

  // Extract all faces with their photoId
  const allFaces: { descriptor: Float32Array; photoId: string; box: any; thumbnail?: Blob }[] = [];
  
  for (const photo of photos) {
    if (photo.faces) {
      for (const face of photo.faces) {
        // Ensure descriptor is a Float32Array (it may be a plain Array after IndexedDB round-trip)
        const desc = face.descriptor instanceof Float32Array 
            ? face.descriptor 
            : new Float32Array(face.descriptor);
        console.log(`[Cluster] Photo ${photo.name}: descriptor length=${desc.length}, first 5 values=[${Array.from(desc.slice(0, 5)).map(v => v.toFixed(4))}]`);
        allFaces.push({
          descriptor: desc,
          photoId: photo.id,
          box: face.box,
          thumbnail: face.thumbnail
        });
      }
    }
  }

  console.log(`[Cluster] Total faces to cluster: ${allFaces.length}`);

  const clusters: FaceCluster[] = [];

  for (const face of allFaces) {
    let bestMatchIndex = -1;
    let minDistance = Infinity;

    // Compare with existing cluster centroids
    for (let i = 0; i < clusters.length; i++) {
        const cluster = clusters[i]!;
        const distance = faceapi.euclideanDistance(
            Array.from(face.descriptor), 
            Array.from(cluster.descriptor)
        );
        console.log(`[Cluster] Distance between face and cluster ${i} ("${cluster.label}"): ${distance.toFixed(4)}`);
        if (distance < CLUSTER_THRESHOLD && distance < minDistance) {
            minDistance = distance;
            bestMatchIndex = i;
        }
    }

    // Check custom threshold for the best match if it exists
    if (bestMatchIndex !== -1) {
        const cluster = clusters[bestMatchIndex]!;
        const threshold = cluster.config?.similarityThreshold ?? CLUSTER_THRESHOLD;
        
        if (minDistance > threshold) {
            bestMatchIndex = -1; // No match within custom threshold
        }
    }

    if (bestMatchIndex !== -1) {
        const matched = clusters[bestMatchIndex]!;
        matched.photoIds.push(face.photoId);
         if (!matched.thumbnail && face.thumbnail) {
             matched.thumbnail = face.thumbnail;
         }
    } else {
        // Create new cluster — try to carry over label from existing persisted clusters
        const label = findExistingLabel(existingClusters, face.descriptor, clusters.length);
        clusters.push({
            id: crypto.randomUUID(),
            label,
            descriptor: face.descriptor,
            photoIds: [face.photoId],
            thumbnail: face.thumbnail
        });
    }
  }

  // Sort clusters by size (most frequent faces first)
  clusters.sort((a, b) => b.photoIds.length - a.photoIds.length);

  // Persist clusters to DB
  for (const cluster of clusters) {
    await saveCluster(cluster);
  }

  return clusters;
  return clusters;
}

/**
 * Recalculates the cluster centroid (descriptor) based on confirmed photos.
 * If no photos are confirmed, it uses all associated photos.
 * This allows the "concept" of a person to evolve as the user provides feedback.
 */
export async function recalculateClusterCentroid(clusterId: string): Promise<void> {
  const db = await getDB();
  
  // Get the cluster
  // We need to implement getCluster in db.ts or just get all and find
  // For efficiency let's assume we can get all for now, or add getCluster later.
  // Using getAllClusters for now as it's available.
  const clusters = await getAllClusters();
  const cluster = clusters.find(c => c.id === clusterId);
  
  if (!cluster) {
    console.error(`[Cluster] Cluster ${clusterId} not found for recalculation`);
    return;
  }

  // Determine which photos to use for centroid calculation
  // Priority: Confirmed photos > All photos
  // Actually, "All photos" might include wrongly clustered ones, so maybe we should matches 
  // ONLY if no confirmed photos exist?
  // Strategy: 
  // 1. If confirmedPhotoIds has entries, use ONLY those faces. This "purifies" the cluster.
  // 2. If no confirmed IDs, keep current descriptor (or re-average all if needed, but current is likely average already).
  
  const targetPhotoIds = (cluster.confirmedPhotoIds && cluster.confirmedPhotoIds.length > 0)
    ? cluster.confirmedPhotoIds
    : cluster.photoIds;

  if (targetPhotoIds.length === 0) return;

  // We need to perform the recalculation.
  // 1. Get DB
  // 2. Fetch all target photos
  // 3. Find the matching face in each photo (closest to current cluster descriptor)
  // 4. Average the descriptors
  
  const allDescriptors: Float32Array[] = [];
  
  // We need to fetch photos. Since we don't have a direct `getPhoto` imported yet, 
  // let's rely on standard logic or add it. 
  // For now, to make progress, I will assume we can fetch them. 
  // Since `photoIds` are unique, we might need a `getPhoto` in `db.ts`. 
  // I will add `getPhoto` to `db.ts` in the next step.
  
  for (const photoId of targetPhotoIds) {
      // @ts-ignore - verify existence in db.ts later
      const photo = await db.get('photos', photoId) as Photo | undefined;
      
      if (photo && photo.faces) {
          // Find the face that matches this cluster
          let bestFaceDesc: Float32Array | null = null;
          let bestDist = Infinity;
          
          for (const face of photo.faces) {
              const desc = face.descriptor instanceof Float32Array 
                  ? face.descriptor 
                  : new Float32Array(face.descriptor);
              
              const dist = faceapi.euclideanDistance(desc, cluster.descriptor);
              if (dist < CLUSTER_THRESHOLD && dist < bestDist) {
                   bestDist = dist;
                   bestFaceDesc = desc;
              }
          }
          
          if (bestFaceDesc) {
              allDescriptors.push(bestFaceDesc);
          }
      }
  }
  
  if (allDescriptors.length > 0) {
      // Calculate mean descriptor
      const firstDesc = allDescriptors[0];
      if (!firstDesc) return;

      const numDims = firstDesc.length;
      const mean = new Float32Array(numDims);
      
      for (const desc of allDescriptors) {
          for (let i = 0; i < numDims; i++) {

              const val = desc[i];
              const current = mean[i];
              if (val !== undefined && current !== undefined) {
                  mean[i] = current + val;
              }
          }
      }
      
      for (let i = 0; i < numDims; i++) {
          const val = mean[i];
          if (val !== undefined) {
              mean[i] = val / allDescriptors.length;
          }
      }
      
      // Update cluster
      cluster.descriptor = mean;
      await saveCluster(cluster);
      console.log(`[Cluster] Recalculated centroid for ${cluster.label} using ${allDescriptors.length} faces.`);
  }
}

function findExistingLabel(
  existingClusters: FaceCluster[],
  descriptor: Float32Array,
  currentIndex: number,
): string {
  const defaultLabel = `Person ${currentIndex + 1}`;

  for (const existing of existingClusters) {
    const existingDesc = existing.descriptor instanceof Float32Array
      ? existing.descriptor
      : new Float32Array(existing.descriptor);
    const distance = faceapi.euclideanDistance(
      Array.from(descriptor),
      Array.from(existingDesc),
    );
    if (distance < LABEL_CARRY_OVER_THRESHOLD) {
      return existing.label;
    }
  }

  return defaultLabel;
}


export async function getUnrecognizedPhotos(sessionId: string): Promise<Photo[]> {
  const db = await getDB();
  const photos = await db.getAllFromIndex('photos', 'by-session', sessionId);
  
  // Filter for photos that have no faces detected
  // unrecognized means: faces array is empty or undefined, OR noFaceMatch is true (though noFaceMatch might be used for logic elsewhere)
  return photos.filter(p => !p.faces || p.faces.length === 0);
}
