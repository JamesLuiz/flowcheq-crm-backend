import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { AppSettingsModel, UserModel } from '../store/schemas';
import type { UserPublic } from '../types';

export async function getAuthStatus(): Promise<{ signupAllowed: boolean; hasUser: boolean }> {
  const settings = await AppSettingsModel.findById('global').lean();
  const userCount = await UserModel.countDocuments();
  return {
    signupAllowed: !settings?.signupCompleted && userCount === 0,
    hasUser: userCount > 0,
  };
}

export async function signupUser(input: {
  email: string;
  password: string;
  name?: string;
}): Promise<{ user: UserPublic; token: string }> {
  const status = await getAuthStatus();
  if (!status.signupAllowed) {
    throw new Error('Account registration is closed. Please sign in with your existing account.');
  }

  const email = input.email.trim().toLowerCase();
  const passwordHash = await bcrypt.hash(input.password, 12);
  const doc = await UserModel.create({
    email,
    passwordHash,
    name: input.name?.trim() || 'Flowcheq Admin',
  });

  await AppSettingsModel.findOneAndUpdate(
    { _id: 'global' },
    { $set: { signupCompleted: true, updatedAt: new Date() } },
    { upsert: true, new: true }
  );

  const user = toPublicUser(doc.toObject() as Record<string, unknown>);
  const token = signToken(user);
  return { user, token };
}

export async function loginUser(
  email: string,
  password: string
): Promise<{ user: UserPublic; token: string }> {
  const doc = await UserModel.findOne({ email: email.trim().toLowerCase() });
  if (!doc) throw new Error('Invalid email or password.');

  const ok = await bcrypt.compare(password, String(doc.get('passwordHash')));
  if (!ok) throw new Error('Invalid email or password.');

  const user = toPublicUser(doc.toObject() as Record<string, unknown>);
  return { user, token: signToken(user) };
}

export function signToken(user: UserPublic): string {
  return jwt.sign(
    { sub: user._id, email: user.email, name: user.name },
    config.auth.jwtSecret,
    { expiresIn: config.auth.jwtExpiresIn } as jwt.SignOptions
  );
}

export function verifyToken(token: string): UserPublic | null {
  try {
    const payload = jwt.verify(token, config.auth.jwtSecret) as {
      sub: string;
      email: string;
      name: string;
    };
    return { _id: payload.sub, email: payload.email, name: payload.name };
  } catch {
    return null;
  }
}

function toPublicUser(doc: Record<string, unknown>): UserPublic {
  return {
    _id: String(doc._id),
    email: String(doc.email),
    name: String(doc.name || 'Flowcheq Admin'),
  };
}
