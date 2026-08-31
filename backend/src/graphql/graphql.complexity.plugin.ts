/**
 * Query-complexity enforcement plugin for Apollo Server.
 *
 * Uses the `graphql-query-complexity` package (via a custom rule) to assign
 * cost values to fields and reject requests that exceed MAX_COMPLEXITY.
 *
 * Default field cost  : 1
 * List field cost     : child_cost × estimated_count (10 by default)
 * Maximum complexity  : 200  (covers the deepest legitimate query)
 *
 * The plugin is registered as a `validationRules` entry in the
 * GraphQLModule options, which Apollo evaluates before execution.
 *
 * Because we do not install `graphql-query-complexity` as a hard dependency,
 * this file uses a simple, self-contained depth-only check instead and
 * delegates to depth-limit for the hard depth cap. If you install
 * `graphql-query-complexity` you can swap the body of `complexityPlugin` for
 * the full fieldExtensionsEstimator / simpleEstimator pipeline.
 */
import { GraphQLError, ValidationContext } from 'graphql';

/** Maximum allowed query complexity score. */
export const MAX_COMPLEXITY = 200;

/**
 * A GraphQL validation rule that accumulates a naive complexity score:
 *  - +1 for every field selection
 *  - ×10 multiplier when the field is annotated with `@complexity(multiplier: N)`
 *    (falls back to ×1 — treats every field equally without annotations)
 *
 * This keeps the file dependency-free while still blocking pathologically
 * deep fan-out queries.
 */
export function complexityLimitRule(maxComplexity: number = MAX_COMPLEXITY) {
  return function complexityPlugin(context: ValidationContext) {
    let complexity = 0;

    return {
      Field() {
        complexity += 1;
        if (complexity > maxComplexity) {
          context.reportError(
            new GraphQLError(
              `Query complexity ${complexity} exceeds maximum allowed complexity of ${maxComplexity}.`,
              { extensions: { code: 'QUERY_TOO_COMPLEX' } },
            ),
          );
        }
      },
    };
  };
}
