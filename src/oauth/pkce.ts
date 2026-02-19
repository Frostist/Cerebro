/** Verify a PKCE code_verifier against a stored code_challenge (S256 method) */
export async function verifyCodeChallenge(verifier: string, challenge: string): Promise<boolean> {
  const encoded = new TextEncoder().encode(verifier);
  const hashBuf = await crypto.subtle.digest('SHA-256', encoded);
  const computed = Buffer.from(hashBuf).toString('base64url');
  return computed === challenge;
}
