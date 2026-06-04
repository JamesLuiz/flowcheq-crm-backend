import type { Request, Response, NextFunction } from 'express';
import passport from 'passport';
import { ExtractJwt, Strategy as JwtStrategy } from 'passport-jwt';
import { config } from '../config';

const PUBLIC_SUFFIXES = ['/auth/login', '/auth/signup', '/auth/status'];

export function configurePassport(): void {
  passport.use(
    new JwtStrategy(
      {
        jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
        secretOrKey: config.auth.jwtSecret,
      },
      (payload: { sub: string; email: string; name: string }, done) => {
        if (payload?.sub) {
          done(null, { _id: payload.sub, email: payload.email, name: payload.name });
        } else {
          done(null, false);
        }
      }
    )
  );
}

function isPublicApiPath(req: Request): boolean {
  const full = req.originalUrl || req.url;
  return PUBLIC_SUFFIXES.some((s) => full.includes(s));
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (config.auth.disabled) {
    next();
    return;
  }
  if (isPublicApiPath(req)) {
    next();
    return;
  }

  passport.authenticate('jwt', { session: false }, (err: Error | null, user: unknown) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    if (!user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    (req as Request & { user: unknown }).user = user;
    next();
  })(req, res, next);
}
