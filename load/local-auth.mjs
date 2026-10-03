/**
 * A local JWKS endpoint and token minter, for load testing only.
 *
 * `requireAuth` verifies tokens against `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`.
 * Pointing SUPABASE_URL at this server makes the **real, unmodified** auth
 * middleware work locally — jose, the JWKS fetch, its cache and the signature
 * check all run exactly as in production. That is deliberately better than a
 * test-only bypass: a bypass would measure a code path that does not exist in
 * production and would be a standing invitation to ship it by accident.
 *
 *   node load/local-auth.mjs            # serves JWKS on :8899, prints a token
 *   node load/local-auth.mjs --port 9000 --ttl 7200
 *
 * Then:
 *   SUPABASE_URL=http://127.0.0.1:8899 PORT=3101 npx tsx src/server.ts
 *   TOKEN=<printed> API_URL=http://localhost:3101 k6 run load/calculator.js
 *
 * The key is generated fresh on every start and never written to disk, so
 * nothing here can be mistaken for a credential.
 */
import { createServer } from "node:http";
import { generateKeyPair, exportJWK, SignJWT } from "jose";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};

const PORT = Number(flag("port", 8899));
const TTL_SECONDS = Number(flag("ttl", 3600));
const USER_ID = flag("user", "11111111-1111-4111-8111-111111111111");
const EMAIL = flag("email", "loadtest@example.invalid");

const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
const jwk = await exportJWK(publicKey);
jwk.kid = "loadtest-key";
jwk.alg = "RS256";
jwk.use = "sig";

const token = await new SignJWT({ sub: USER_ID, email: EMAIL, role: "authenticated" })
  .setProtectedHeader({ alg: "RS256", kid: jwk.kid })
  .setIssuedAt()
  .setExpirationTime(`${TTL_SECONDS}s`)
  .sign(privateKey);

const server = createServer((req, res) => {
  if (req.url === "/auth/v1/.well-known/jwks.json") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ keys: [jwk] }));
    return;
  }
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end('{"error":"not found"}');
});

server.listen(PORT, "127.0.0.1", () => {
  console.error(`JWKS on http://127.0.0.1:${PORT}/auth/v1/.well-known/jwks.json`);
  console.error(`user ${USER_ID}, token valid ${TTL_SECONDS}s`);
  console.error("");
  // stdout carries only the token, so it can be captured directly.
  console.log(token);
});
