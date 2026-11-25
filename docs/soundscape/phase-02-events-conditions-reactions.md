# Phase 02 — Typed Event Bus, Condition Evaluator & Reaction Chains

## Objective
Unify all player, environmental, and stochastic sound triggers under one typed event bus with deduplication, causation tracing, declarative condition evaluation, and bounded secondary reaction chains.

## Interfaces & Contracts
- `SimulationEvent<T>`: `{ id, type, origin, simulationTimestamp, position?, sourceEntityId?, targetEntityId?, intensity?, correlationId?, causationId?, chainDepth, payload }`.
- `ConditionEvaluator`: Supports `all`, `any`, `not`, comparisons (`eq`, `neq`, `gt`, `gte`, `lt`, `lte`), `in`, `not_in`, `between`, midnight-crossing time windows, `within` weather history, `distance_to_feature`, listener/source/triggering-entity scopes, `duration_of_truth` / `hysteresis`, and registered custom evaluators—always emitting human-readable eligibility and rejection reasons.
- `EventReactionEngine`: Evaluates reaction rules on matching events with probability, optional random delay, schedule/execution condition timing, atomic quota reservation, and strict `maxChainDepth` + `maxEventsPerChain` caps.

## Verification Criteria
- Correlated events within dedupe windows do not double-trigger.
- Reaction loops terminate cleanly at configured depth/total-event limits.
- Condition changes during a pending delay cancel or update execution cleanly when configured.
