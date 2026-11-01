# Next.js route example

Copy `app/api/ahttp/authorize/route.ts`, `app/api/ahttp/action/route.ts` and `lib/policy.ts` into a Next.js app. Set `AGENT_TOKEN` in the server environment.

The authorize route returns the short-lived policy. The action route is the enforcement point: it checks the same agent token and rejects intents outside the allow list. Wire the engine's `authorizeAction` hook to `POST /api/ahttp/action` so the client asks before a mutation, but keep the server check in the endpoint that actually performs the operation.

The route files are illustrative and are not run by this repository's root tests because Next.js is not a dependency. The Express example in `../auth-server/` is runnable.
