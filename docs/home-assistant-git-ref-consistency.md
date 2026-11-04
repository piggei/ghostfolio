# Home Assistant Git reference confirmation

## Scope and observed failure

This local correction starts at controller C,
`bfaf9ff86325d3d6fb25c37785e854cc583077df`. It excludes the later registry-only
reservation and qualification commits. No release identity or registry is changed.

Run `41914405143`, AMD64 job `126870528091`, failed at the final assertion in
`GitHub.commit()`: the observed HEAD was reservation commit
`fc822fc14274a03c040bc211b32227a033ffb6d1`, while the expected HEAD was qualification
commit `1899cdb43241dcb4f68efaac4df14e64089a212e`. The latter commit is on the HA
branch and contains generation 3 and the AMD64 evidence for version `3.97.2`.
The log identifies the failed assertion, but does not record the PATCH HTTP
response. It cannot distinguish a stale replica/cache from another source of
obsolete reads, or prove that the PATCH returned an ordinary successful response.

## Confirmation contract

The existing pre-write HEAD checks and `force: false` remain mandatory. Before
PATCH, the created commit is read by immutable SHA and must have exactly the
expected parent and generated tree. A successful PATCH body must identify the
exact branch, commit object type and SHA.

Only one PATCH is attempted. Transport failures, response-body decode failures,
HTTP 408 and HTTP 5xx have uncertain outcomes: confirmation uses GET only.
Explicit other HTTP errors, including 401/403/409/422/429, fail immediately.
An inconsistent, decoded successful response also fails immediately.

Confirmation allows at most five HEAD observations, with waits of 100, 250, 500
and 1000 milliseconds. Only the verified immediate predecessor permits a wait.
The exact expected SHA confirms success. Any foreign SHA, invalid metadata, read
failure or exhausted observations fails closed. Creating a commit object alone
never proves that the branch update happened. An ambiguous PATCH error is retained
as the cause if confirmation fails. Each API call retains its 30-second timeout;
the five-observation limit bounds retries, not a 1.85-second total HTTP deadline.

`snapshot(plan.head)` applies the same rule. When the first HEAD differs, it reads
the immutable expected commit and verifies its single parent. It never reads
registry or metadata files until the branch has been observed at the expected
SHA. Every file is then read at that SHA. Snapshots without an expected SHA retain
the existing read-only behavior.

This is bounded confirmation, not a linearizable lock or a compare-and-swap API.
GitHub's non-forced ref update rejects a diverging concurrent commit; external
force updates remain outside this guarantee. A concurrent descendant, even one
containing our commit, is rejected rather than silently adopted. Later writers
can still advance the branch after any observation: subsequent snapshot/pre-write
checks remain necessary. No PATCH, build, publication or qualification retry is
introduced by this correction.

## Recovery assessment for 3.97.2 — plan only

The recorded identity must retain `addon_source_revision` C, NG commit
`0e24e1a7cec9a4f47422eb5c6889332c78ba1c13` and its original source image digest.
The generation-3 registry and AMD64 digest
`sha256:9f2ccd3f757699dcf55a1d57a46c9c056df94081edcc27db9c520ace742a7072`
must remain unchanged while obtaining a fresh plan. Version `3.97.1` is untouched.

1. Under separate authorization, first recheck the remote registry, exact identity,
   HA code against C, source provenance, candidate by digest, metadata version,
   absence of final tags/images and absence of competing publication runs.
2. A failed-job-only retry must not reuse the prepare plan whose HEAD is still
   `fc822fc...`; it will conflict with `1899cdb...`. The failed AMD64 step did not
   upload its updated plan artifact.
3. A fresh full preparation using the original C implementation and exact identity
   can adopt the current registry HEAD without allocating a version or changing
   generation 3. Repeating AMD64 qualification must pull its recorded immutable
   digest, repeat native smoke and registry validation, and produce no commit or
   generation change for identical evidence. This behavior has a local regression.
4. Only later ARM64 qualification/publication/activation may legitimately advance
   generations. Each architecture must actually pass its native checks. A separate
   production approval must cover those operations; none is performed here.

The old C implementation still has the read-after-write failure mode on future
writes. A full retry using C is therefore a recovery option with a known risk,
not qualification of this fix or an authorized operation. Do not run it blindly.
Installing the corrected controller on the HA branch first would instead make
`verifyAddonRevision(C, head)` reject the changed controller source. Changing the
reservation identity to a new SHA is also rejected as a conflicting retry. An
updated orchestrator pin alone cannot solve this compatibility boundary.

Accordingly, recovery with C before deploying this fix, versus a separately
reviewed mechanism separating recovery controller execution from the immutable
add-on identity, requires a human decision. No special recovery implementation,
identity migration or provenance exception is included in this patch. Publication
of the permanent fix and its future orchestrator pin remain separate checkpoints.
