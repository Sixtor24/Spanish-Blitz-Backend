/**
 * Speech evaluation routes
 */
import { Router } from 'express';
import { withErrorHandler, ApiError } from '../middleware/error.js';
import { evaluateSpeechAnswer } from '../services/speechUtils.js';

const router = Router();

/**
 * POST /api/speech/evaluate
 * Evaluate a speech transcript against a target answer
 */
router.post('/evaluate', withErrorHandler(async (req, res) => {
  const { transcript, target, confidence } = req.body;

  if (!transcript || !target) {
    throw new ApiError(400, "transcript and target are required");
  }

  const result = evaluateSpeechAnswer(
    transcript,
    target,
    confidence
  );

  return res.json(result);
}, 'POST /api/speech/evaluate'));

export default router;
