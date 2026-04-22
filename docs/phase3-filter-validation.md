# Phase 3 Path-Filter Validation — R4 scenario (dummy)

Dummy documentation file + a misplaced `.spec.ts` file simulating the
R4 failure scenario (docs PR that inadvertently includes a spec
rename / addition) for PR [#2908](https://github.com/kitelev/exocortex/pull/2908).

The restrictive regex in the filter should detect the spec file and
force the gated e2e jobs to run despite the predominantly docs diff.

Will be closed without merge once R4 behavior is verified.
