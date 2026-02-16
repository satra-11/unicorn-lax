import type { Photo, FaceCluster } from './types';
import { getDB } from './db';
import { CLUSTER_THRESHOLD } from './clustering';
import * as faceapi from 'face-api.js';

interface ScoredPhoto {
  photo: Photo;
  subjects: string[];
  matched: boolean;
}

function matchPhotoToSubjects(
  photo: Photo,
  targetClusters: FaceCluster[]
): { subjects: string[]; matched: boolean } {
  if (!photo.faces || photo.faces.length === 0) {
    return { subjects: [], matched: false };
  }

  const subjects = new Set<string>();
  for (const face of photo.faces) {
    for (const cluster of targetClusters) {
      if (faceapi.euclideanDistance(face.descriptor, cluster.descriptor) < CLUSTER_THRESHOLD) {
        subjects.add(cluster.id);
      }
    }
  }

  return { subjects: Array.from(subjects), matched: subjects.size > 0 };
}

function buildScoredPhotos(
  allPhotos: Photo[],
  targetClusters: FaceCluster[]
): ScoredPhoto[] {
  return allPhotos.map(photo => {
    const { subjects, matched } = matchPhotoToSubjects(photo, targetClusters);
    return { photo: { ...photo, noFaceMatch: !matched }, subjects, matched };
  });
}

export async function selectGroupBalancedPhotos(
  sessionId: string,
  targetClusters: FaceCluster[],
  count: number
): Promise<Photo[]> {
  const db = await getDB();
  const allPhotos = await db.getAllFromIndex('photos', 'by-session', sessionId);

  const scoredPhotos = buildScoredPhotos(allPhotos, targetClusters);

  // Sort by time
  scoredPhotos.sort((a, b) => a.photo.timestamp - b.photo.timestamp);

  if (scoredPhotos.length === 0) return [];

  // Separate matched and unmatched
  const matched = scoredPhotos.filter(p => p.matched);
  const unmatched = scoredPhotos.filter(p => !p.matched);

  // Select from matched photos using time-bucketed balanced approach
  const selected: Photo[] = [];
  const subjectCounts = new Map<string, number>();
  targetClusters.forEach(c => subjectCounts.set(c.id, 0));

  if (matched.length > 0) {
    const startTime = matched[0]!.photo.timestamp;
    const endTime = matched[matched.length - 1]!.photo.timestamp;
    const duration = endTime - startTime;
    const interval = duration / count;

    for (let i = 0; i < count; i++) {
      const bucketStart = startTime + (i * interval);
      const bucketEnd = bucketStart + interval;

      const bucketPhotos = matched.filter(p =>
        p.photo.timestamp >= bucketStart && p.photo.timestamp < bucketEnd
      );

      if (bucketPhotos.length === 0) continue;

      let bestPhoto = bucketPhotos[0]!;
      let bestScore = -Infinity;

      for (const p of bucketPhotos) {
        let score = 0;
        p.subjects.forEach(subId => {
          const cnt = subjectCounts.get(subId) || 0;
          score -= cnt;
        });

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
  }

  // Append unmatched photos (no face detected / no match) so users can review them
  const unmatchedPhotos = unmatched.map(p => p.photo);

  return [...selected, ...unmatchedPhotos];
}

export async function selectGrowthPhotos(
  sessionId: string,
  targetCluster: FaceCluster,
  count: number
): Promise<Photo[]> {
  const db = await getDB();
  const allPhotos = await db.getAllFromIndex('photos', 'by-session', sessionId);

  const scoredPhotos = buildScoredPhotos(allPhotos, [targetCluster]);

  scoredPhotos.sort((a, b) => a.photo.timestamp - b.photo.timestamp);

  if (scoredPhotos.length === 0) return [];

  const matched = scoredPhotos.filter(p => p.matched);
  const unmatched = scoredPhotos.filter(p => !p.matched);

  const selected: Photo[] = [];

  if (matched.length > 0) {
    const startTime = matched[0]!.photo.timestamp;
    const endTime = matched[matched.length - 1]!.photo.timestamp;
    const duration = endTime - startTime;
    const interval = duration / count;

    for (let i = 0; i < count; i++) {
      const bucketStart = startTime + (i * interval);
      const bucketEnd = bucketStart + interval;

      const bucketPhotos = matched.filter(p =>
        p.photo.timestamp >= bucketStart && p.photo.timestamp < bucketEnd
      );

      if (bucketPhotos.length > 0) {
        const bucketCenter = bucketStart + (interval / 2);

        const best = bucketPhotos.reduce((prev, curr) =>
          Math.abs(curr.photo.timestamp - bucketCenter) < Math.abs(prev.photo.timestamp - bucketCenter) ? curr : prev
        );

        selected.push(best.photo);
      }
    }
  }

  const unmatchedPhotos = unmatched.map(p => p.photo);

  return [...selected, ...unmatchedPhotos];
}
