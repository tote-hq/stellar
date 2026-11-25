import { argon2Verify } from 'hash-wasm';

/** Public dummy. Unknown users still run a verify so the branch is not a fast reject. */
export const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=16384,t=2,p=1$AQIDBAUGBwgJCgsMDQ4PEA$CqYqe/77QHPNOD2kaRvLyCOd4y3+sAKWlx8zGLoDDLY';

export async function passwordMatches(password: string, hash: string): Promise<boolean> {
  try {
    return await argon2Verify({ password, hash });
  } catch {
    return false;
  }
}
