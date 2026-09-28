# Edge Rate Limits

The Nginx edge has two per-client buckets:

- `/v1/auth/*` and `/api/v1/auth/*`: 5 requests/minute with a burst of 5.
- Public/API reads: 60 requests/minute with a burst of 30.

Both return HTTP 429 when the bucket is exhausted. Nginx extracts the real address from `X-Forwarded-For` only when the immediate proxy is in the configured private network ranges; keep those ranges aligned with the load balancer or ingress network and never trust arbitrary public proxy headers.

Validate the config with `nginx -t`, then run the smoke test against an Nginx endpoint:

```sh
BASE_URL=https://api.agri-fi.example.com \
  devops/nginx/test-rate-limits.sh
```

The script expects at least one HTTP 429 from each bucket. Run it from a controlled test client and avoid using production credentials.
