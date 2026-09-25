### Summary
This PR implements comprehensive testing coverage across backend services and validations, ensures strict authorization checks on WebSocket connections, disables server engine signature headers for improved security, and configures database query auditing for AWS CloudWatch.

### Changes
- Implemented unit tests for UserService and AuthController to validate registration endpoints, mock JWT sign helpers, and test password hashing calls.
- Implemented strict authorization checks on WebSocket connections to disconnect unauthorized users.
- Disabled `x-powered-by` server engine signature header in Express.
- Configured database query auditing to log queries to AWS CloudWatch.

### Resolves
Closes #440
Closes #421
Closes #424
Closes #420
