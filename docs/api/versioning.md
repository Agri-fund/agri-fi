# API Versioning and Deprecation Policy

## Version Strategy

The public Agri-Fi API uses URI versioning. The current stable contract is v1:

```
GET /v1/trade-deals
POST /v1/auth/login
```

Clients must include the major version in the URI and should use the `API-Version` response header to confirm the version that served the request. v2 is reserved for a future, incompatible public contract; it is not an alias for v1 and must not replace v1 routes in place.

## Compatibility Rules

The following changes are backward compatible and may be released in v1:

- adding a new endpoint, optional request field, optional response field, response header, or enum value documented as extensible;
- relaxing a validation rule; and
- fixing a defect where the documented contract was not honored.

The following changes require a new major version:

- removing or renaming an endpoint, field, enum value, or response header;
- making an optional request field required, tightening validation, changing authentication or authorization requirements, or changing error semantics;
- changing the meaning, type, format, or unit of an existing field; and
- changing pagination, ordering, idempotency, rate-limit, or asynchronous-processing behavior in a way clients must handle differently.

For every API pull request, generate the version's OpenAPI specification and compare it with the baseline in CI. The OpenAPI diff must show only additive changes for a v1 change. Any detected breaking change must link to the related issue and be delivered through a proposed v2 contract instead of silently changing v1.

## Deprecation and Sunset

Deprecation applies to a route, field, or an entire API version only when a supported replacement is available. The deprecation announcement must identify the replacement and migration guidance.

When deprecation begins, affected successful responses must include:

```
Deprecation: true
Sunset: <HTTP-date>
Link: <replacement-documentation>; rel="deprecation"
```

The `Sunset` date must be at least 12 months after the initial announcement and after the replacement reaches general availability. Announce the sunset in release notes and to registered API contacts when available. Keep the headers in every affected response until removal, and repeat the planned removal date in the API documentation.

At 90 and 30 days before sunset, publish a reminder. A deprecated endpoint or version may be removed only on or after its advertised sunset date, after the 12-month support period, and after a final OpenAPI diff confirms that the removal is isolated to the deprecated v1 surface. Security or legal emergencies may require a shorter period; document the reason, replacement, and revised timeline in the related issue and release notes.

## Proposing v2

Open an issue before implementing a breaking change. The proposal must describe the v1 contract, the incompatibility, the v2 URI and OpenAPI changes, migration steps, and the deprecation and sunset dates for v1.

After review, implement v2 under `/v2/...` alongside v1. Do not redirect a v1 request to v2. Publish version-specific OpenAPI documentation, add migration examples, and keep v1 behavior stable until its announced sunset. The v2 pull request must include tests for both versions and the CI OpenAPI diff for the version it changes.

## Related Guides

See the [API guide](../../backend/docs/API.md) for current endpoints and API access details.
