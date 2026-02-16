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

