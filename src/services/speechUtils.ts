/**
 * Speech Recognition Utilities
 * Normalization + Levenshtein + Lenient Evaluation for Spanish speech recognition
 */

/**
 * Normalize Spanish text for comparison
 * - Lowercase
 * - Remove punctuation
 * - Remove accents/diacritics
 * - Convert ñ to n (lenient matching)
 * - Collapse multiple spaces
 */
export function normalizeSpanish(text: string): string {
  if (!text) return "";

  return text
    .toLowerCase()
    .trim()
    // Remove punctuation
    .replace(/[.,!?¿¡:;"'(){}\[\]]/g, "")
    // Normalize accents (NFD = decompose, then remove combining marks)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    // Treat ñ as n (lenient for learners)
    .replace(/ñ/g, "n")
    // Collapse multiple spaces
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Calculate Levenshtein distance between two strings
 * Returns the minimum number of single-character edits (insertions, deletions, substitutions)
 */
export function levenshtein(a: string, b: string): number {
  const matrix = Array.from({ length: a.length + 1 }, () =>
    new Array(b.length + 1).fill(0)
  );

  for (let i = 0; i <= a.length; i++) matrix[i][0] = i;
  for (let j = 0; j <= b.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,     // deletion
        matrix[i][j - 1] + 1,     // insertion
        matrix[i - 1][j - 1] + cost // substitution
      );
    }
  }

  return matrix[a.length][b.length];
}

/**
 * Remove common Spanish articles from text
 * Helps with cases like "el pavo" vs "pavo"
 */
export function removeSpanishArticles(text: string): string {
  const articles = ["el", "la", "los", "las", "un", "una", "unos", "unas"];
  const words = text.split(" ").filter(word => word.length > 0);
  const filtered = words.filter(word => !articles.includes(word));
  return filtered.join(" ");
}

export type SpeechResult = {
  accepted: boolean;
  isExact: boolean;
  distance: number;
  similarity: number;
  normalizedTranscript: string;
  normalizedTarget: string;
};

/**
 * Evaluate speech answer with lenient matching
 * 
 * Applies:
 * 1. Exact match (after normalization)
 * 2. Close enough (Levenshtein with length-based thresholds)
 * 3. Article tolerance (ignores articles)
 */
export function evaluateSpeechAnswer(
  transcriptRaw: string,
  targetRaw: string,
  confidence?: number
): SpeechResult {
  const transcript = normalizeSpanish(transcriptRaw);
  const target = normalizeSpanish(targetRaw);

  // Empty or unusable transcript
  if (transcript.length < 2) {
    return {
      accepted: false,
      isExact: false,
      distance: Infinity,
      similarity: 0,
      normalizedTranscript: transcript,
      normalizedTarget: target,
    };
  }

  // Exact match
  if (transcript === target) {
    return {
      accepted: true,
      isExact: true,
      distance: 0,
      similarity: 1,
      normalizedTranscript: transcript,
      normalizedTarget: target,
    };
  }

  // Try with articles removed
  const transcriptNoArticles = removeSpanishArticles(transcript);
  const targetNoArticles = removeSpanishArticles(target);

  if (transcriptNoArticles === targetNoArticles && transcriptNoArticles.length >= 2) {
    return {
      accepted: true,
      isExact: false,
      distance: 0,
      similarity: 1,
      normalizedTranscript: transcript,
      normalizedTarget: target,
    };
  }

  // Calculate Levenshtein distance
  const distance = levenshtein(transcript, target);
  const maxLen = Math.max(transcript.length, target.length);
  const similarity = 1 - distance / maxLen;

  // Lenient thresholds by word length
  let accepted = false;
  let threshold = 0;

  if (maxLen <= 4) {
    threshold = 1;
    accepted = distance <= 1;
  } else if (maxLen <= 7) {
    threshold = 2;
    accepted = distance <= 2;
  } else {
    threshold = 3;
    accepted = distance <= 3 || similarity >= 0.8;
  }

  // If confidence is low, be more lenient
  if (confidence !== undefined && confidence < 0.6) {
    if (similarity >= 0.75) {
      accepted = true;
    } else if (distance <= threshold + 1) {
      accepted = true;
    }
  }

  return {
    accepted,
    isExact: false,
    distance,
    similarity,
    normalizedTranscript: transcript,
    normalizedTarget: target,
  };
}
