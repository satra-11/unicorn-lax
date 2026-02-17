import type { Photo, FaceCluster } from './types';
import { CLUSTER_THRESHOLD } from './clustering';
import * as faceapi from 'face-api.js';

// Photos within this time window are considered part of the same burst
const BURST_THRESHOLD_MS = 2000;

interface BurstGroup {
  photos: Photo[];
}

/**
 * Groups photos into burst groups based on timestamp proximity.
 * Photos taken within BURST_THRESHOLD_MS of each other are grouped together.
 */
export function groupBurstPhotos(photos: ReadonlyArray<Photo>): BurstGroup[] {
  if (photos.length === 0) return [];

  const sorted = [...photos].sort((a, b) => a.timestamp - b.timestamp);
  const groups: BurstGroup[] = [];
  let currentGroup: Photo[] = [sorted[0]!];

  for (let i = 1; i < sorted.length; i++) {
    const photo = sorted[i]!;
    const prevPhoto = sorted[i - 1]!;

    if (photo.timestamp - prevPhoto.timestamp <= BURST_THRESHOLD_MS) {
      currentGroup.push(photo);
    } else {
      groups.push({ photos: currentGroup });
      currentGroup = [photo];
    }
  }

  groups.push({ photos: currentGroup });
  return groups;
}

/**
 * Calculates the total face area in a photo (sum of all bounding box areas).
 */
function totalFaceArea(photo: Photo): number {
  if (!photo.faces || photo.faces.length === 0) return 0;
  return photo.faces.reduce((sum, face) => {
    const { width, height } = face.box;
    return sum + (width ?? 0) * (height ?? 0);
  }, 0);
}

/**
 * Counts how many target subjects appear in a photo.
 */
function countMatchedSubjects(
  photo: Photo,
  targetClusters: ReadonlyArray<FaceCluster>,
): number {
  if (!photo.faces || photo.faces.length === 0 || targetClusters.length === 0) return 0;

  const matched = new Set<string>();
  for (const face of photo.faces) {
    for (const cluster of targetClusters) {
      const threshold = cluster.config?.similarityThreshold ?? CLUSTER_THRESHOLD;
      if (faceapi.euclideanDistance(face.descriptor, cluster.descriptor) < threshold) {
        matched.add(cluster.id);
      }
    }
  }
  return matched.size;
}

/**
 * Scores a photo for best-shot selection within a burst group.
 *
 * Scoring weights (higher = better):
 *   1. Target subject match count  (weight: 1000)
 *   2. Number of detected faces     (weight: 10)
 *   3. Total face bounding box area (weight: normalized 0-1)
 */
function scorePhoto(
  photo: Photo,
  targetClusters: ReadonlyArray<FaceCluster>,
): number {
  const subjectScore = countMatchedSubjects(photo, targetClusters) * 1000;
  const faceCountScore = (photo.faces?.length ?? 0) * 10;
  const faceAreaScore = totalFaceArea(photo) > 0
    ? Math.min(totalFaceArea(photo) / 100000, 1)
    : 0;

  return subjectScore + faceCountScore + faceAreaScore;
}

/**
 * Selects the best photo from a burst group based on scoring criteria.
 */
export function selectBestFromBurst(
  group: BurstGroup,
  targetClusters: ReadonlyArray<FaceCluster> = [],
): Photo {
  if (group.photos.length === 1) return group.photos[0]!;

  return group.photos.reduce((best, current) => {
    const bestScore = scorePhoto(best, targetClusters);
    const currentScore = scorePhoto(current, targetClusters);
    return currentScore > bestScore ? current : best;
  });
}

/**
 * Deduplicates burst photos by grouping consecutive shots and
 * selecting the best from each group.
 *
 * Non-burst photos (single-photo groups) pass through unchanged.
 */
export function deduplicateBurstPhotos(
  photos: ReadonlyArray<Photo>,
  targetClusters: ReadonlyArray<FaceCluster> = [],
): Photo[] {
  if (photos.length <= 1) return [...photos];

  const groups = groupBurstPhotos(photos);
  return groups.map(group => selectBestFromBurst(group, targetClusters));
}
