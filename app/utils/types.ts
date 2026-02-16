export interface Photo {
  id: string;
  sessionId: string; // references ProcessingSession.id
  name: string;
  relativePath: string;
  timestamp: number;
  dateStr: string; // ISO string
  faces?: {
    descriptor: Float32Array;
    box: { x: number, y: number, width: number, height: number };
    thumbnail?: Blob;
  }[];
  // We avoid storing full Blob in DB alongside metadata to keep it fast, 
  // but might store thumbnail separately or just path if accessing via FileSystemHandle (in future).
  // For now, we assume we re-read file or store thumbnail.
  thumbnail?: Blob;
  noFaceMatch?: boolean;
  excluded?: boolean;
  hash?: string;
  detectionModel?: 'ssd' | 'tiny';
}

export interface ProcessingSession {
  id: string; // e.g. folder name or uuid
  folderName: string;
  totalFiles: number;
  processedCount: number;
  status: 'scanning' | 'processing' | 'completed' | 'paused';
  createdAt: number;
  updatedAt: number;
}

export interface FaceCluster {
  id: string;
  label: string; // e.g. "Person 1" or user assigned name
  descriptor: Float32Array; // centroid or representative descriptor
  photoIds: string[];
  thumbnail?: Blob; // Face crop
  
  // User configuration for this cluster
  config?: {
    similarityThreshold?: number; // Custom threshold (default 0.4)
  };
  
  // IDs of photos explicitly confirmed by user as belonging to this cluster
  // Used to recalculate centroid and improve accuracy
  confirmedPhotoIds?: string[];
}
