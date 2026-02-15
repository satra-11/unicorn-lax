import type { Photo, FaceCluster } from './types';
import { getDB } from './db';
import * as faceapi from 'face-api.js';

export async function selectGroupBalancedPhotos(
  sessionId: string, 
  targetClusters: FaceCluster[], 
  count: number
): Promise<Photo[]> {
  const db = await getDB();
  const allPhotos = await db.getAllFromIndex('photos', 'by-session', sessionId);
  
  // Filter photos that contain AT LEAST one of the target faces
  const candidates = allPhotos.filter(p => {
      if (!p.faces) return false;
      return p.faces.some(face => {
          return targetClusters.some(cluster => 
              faceapi.euclideanDistance(face.descriptor, cluster.descriptor) < 0.6
          );
      });
  });

  // Simple greedy selection for balance?
  // Or bucket based on time?
  // "Equal representation of children"
  // We want each child to appear roughly count / numChildren times.
  
  // Let's try to verify which child is in which photo
  const photosWithSubjects = candidates.map(p => {
      const subjects = new Set<string>();
      if (p.faces) {
          p.faces.forEach(face => {
              targetClusters.forEach(cluster => {
                  if (faceapi.euclideanDistance(face.descriptor, cluster.descriptor) < 0.6) {
                      subjects.add(cluster.id);
                  }
              });
          });
      }
      return { photo: p, subjects: Array.from(subjects) };
  });

  // Sort by time
  photosWithSubjects.sort((a, b) => a.photo.timestamp - b.photo.timestamp);

  // We want to select `count` photos.
  // We also want to cover the timeline.
  // And balance subjects.
  
  // Strategy:
  // 1. Divide timeline into `count` buckets.
  // 2. For each bucket, try to pick a photo.
  // 3. When picking, prefer photos that help balance the subject counts.
  
  const selected: Photo[] = [];
  const subjectCounts = new Map<string, number>();
  targetClusters.forEach(c => subjectCounts.set(c.id, 0));

  if (photosWithSubjects.length === 0) return [];
  
  const startTime = photosWithSubjects[0].photo.timestamp;
  const endTime = photosWithSubjects[photosWithSubjects.length - 1].photo.timestamp;
  const duration = endTime - startTime;
  const interval = duration / count;

  for (let i = 0; i < count; i++) {
      const bucketStart = startTime + (i * interval);
      const bucketEnd = bucketStart + interval;
      
      const bucketPhotos = photosWithSubjects.filter(p => 
          p.photo.timestamp >= bucketStart && p.photo.timestamp < bucketEnd
      );
      
      if (bucketPhotos.length === 0) continue;

      // Score bucket photos based on "Helpfulness to balance"
      // We want to pick a photo that contains a subject with LOWest current count.
      
      let bestPhoto = bucketPhotos[0];
      let bestScore = -Infinity;

      for (const p of bucketPhotos) {
          let score = 0;
          // Calculate score
          p.subjects.forEach(subId => {
              const count = subjectCounts.get(subId) || 0;
              score -= count; // Lower count -> Higher score
          });
          
          // Add face quality score? (not available, assumed box size?)
          
          if (score > bestScore) {
              bestScore = score;
              bestPhoto = p;
          }
      }

      selected.push(bestPhoto.photo);
      bestPhoto.subjects.forEach(subId => {
          subjectCounts.set(subId, (subjectCounts.get(subId) || 0) + 1);
      });
  }

  return selected;
}

export async function selectGrowthPhotos(
  sessionId: string,
  targetCluster: FaceCluster,
  count: number
): Promise<Photo[]> {
  // Similar to above but strictly for one person and timeline focus
  const db = await getDB();
  const allPhotos = await db.getAllFromIndex('photos', 'by-session', sessionId);

  const candidates = allPhotos.filter(p => {
      if (!p.faces) return false;
      return p.faces.some(face => 
          faceapi.euclideanDistance(face.descriptor, targetCluster.descriptor) < 0.6
      );
  });
  
  candidates.sort((a, b) => a.timestamp - b.timestamp);
  
  if (candidates.length === 0) return [];

  const startTime = candidates[0].timestamp;
  const endTime = candidates[candidates.length - 1].timestamp;
  const duration = endTime - startTime;
  const interval = duration / count;
  
  const selected: Photo[] = [];

  for (let i = 0; i < count; i++) {
        const bucketStart = startTime + (i * interval);
        const bucketEnd = bucketStart + interval;
        
        const bucketPhotos = candidates.filter(p => 
            p.timestamp >= bucketStart && p.timestamp < bucketEnd
        );

        if (bucketPhotos.length > 0) {
            // Pick close to center? or just first?
            // Center of bucket is ideal for even spacing.
            const bucketCenter = bucketStart + (interval / 2);
            
            const best = bucketPhotos.reduce((prev, curr) => {
                return Math.abs(curr.timestamp - bucketCenter) < Math.abs(prev.timestamp - bucketCenter) ? curr : prev;
            });
            
            selected.push(best);
        }
  }
  
  return selected;
}
