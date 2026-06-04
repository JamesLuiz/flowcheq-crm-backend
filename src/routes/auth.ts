import { Router } from 'express';
import { asyncHandler } from '../middleware/auth';
import { getAuthStatus, loginUser, signupUser } from '../services/authService';

const router = Router();

router.get(
  '/status',
  asyncHandler(async (_req, res) => {
    res.json(await getAuthStatus());
  })
);

router.post(
  '/signup',
  asyncHandler(async (req, res) => {
    const { email, password, name } = req.body;
    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required.' });
      return;
    }
    if (String(password).length < 8) {
      res.status(400).json({ error: 'Password must be at least 8 characters.' });
      return;
    }
    try {
      const result = await signupUser({ email: String(email), password: String(password), name });
      res.status(201).json(result);
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : 'Signup failed' });
    }
  })
);

router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required.' });
      return;
    }
    try {
      const result = await loginUser(String(email), String(password));
      res.json(result);
    } catch (e) {
      res.status(401).json({ error: e instanceof Error ? e.message : 'Login failed' });
    }
  })
);

export default router;
