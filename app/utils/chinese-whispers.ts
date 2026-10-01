import * as faceapi from 'face-api.js'

export interface CWNode {
  id: number
  descriptor: Float32Array
  classId: number
  isFixed?: boolean
  meta?: any
}

/**
 * Chinese Whispers clustering algorithm implementation for face descriptors
 * @param nodes List of nodes with descriptors
 * @param threshold Similarity threshold (Euclidean distance). Edges are formed if distance < threshold.
 * @param iterations Maximum number of iterations (typically 10-20 is enough)
 * @returns The original nodes array with updated `classId`s
 */
export function chineseWhispers(
  nodes: CWNode[],
  threshold: number = 0.4,
  iterations: number = 20,
): CWNode[] {
  if (nodes.length === 0) return nodes

  // 1. Build adjacency list
  // Edge weight = max(0, threshold - distance) to give higher weight to closer nodes
  const edges: { [id: number]: { to: number; weight: number }[] } = {}
  for (let i = 0; i < nodes.length; i++) {
    edges[i] = []
  }

  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const dist = faceapi.euclideanDistance(
        Array.from(nodes[i]!.descriptor),
        Array.from(nodes[j]!.descriptor),
      )
      if (dist < threshold) {
        // Linear weight based on distance. Closer = higher weight.
        const weight = threshold - dist
        edges[i]!.push({ to: j, weight })
        edges[j]!.push({ to: i, weight })
      }
    }
  }

  // 2. Iterate and update classes
  for (let iter = 0; iter < iterations; iter++) {
    let changed = false

    // Shuffle iteration order
    const order = Array.from({ length: nodes.length }, (_, k) => k).sort(
      () => Math.random() - 0.5,
    )

    for (const i of order) {
      if (nodes[i]!.isFixed) continue

      const classWeights: { [classId: number]: number } = {}

      for (const edge of edges[i]!) {
        const neighborClass = nodes[edge.to]!.classId
        classWeights[neighborClass] = (classWeights[neighborClass] || 0) + edge.weight
      }

      let bestClass = nodes[i]!.classId
      let maxWeight = 0 // if no neighbors, keep current class

      for (const [clsStr, w] of Object.entries(classWeights)) {
        if (w > maxWeight) {
          maxWeight = w
          bestClass = parseInt(clsStr, 10)
        }
      }

      if (nodes[i]!.classId !== bestClass) {
        nodes[i]!.classId = bestClass
        changed = true
      }
    }

    // Convergence
    if (!changed) {
      break
    }
  }

  return nodes
}
