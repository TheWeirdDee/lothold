# Free-tier usage assessment - 2026-10-25

No hosted traffic has been measured. No claim of reliable or permanently free deployment is made. Numbers below are byte measurements from an isolated local checkpoint scenario, plus explicitly conditional projections.

## Measured checkpoint traffic

`docs/evidence/checkpoint-usage.json` records a real encrypted SQLite scenario: register, case, CSV evidence, generated PDF, login after restore, stale-writer rejection and a second fresh-cache restore. Its remote transport is a protocol double, so it measures application payloads, not provider-billed network overhead.

| Quantity | Bytes |
| --- | ---: |
| Initial encrypted snapshot | 282,656 |
| Final encrypted snapshot | 294,944 |
| Publications | 8 |
| Total uploaded to Storage | 2,310,400 |
| Read-back verification plus restores | 2,900,288 |
| Two final retained snapshots | 589,888 |

Every publication now reads back the encrypted object before committing its pointer. Let S be average encrypted checkpoint bytes, W monthly publications, R cold restores and O orphan bytes. Approximate retained storage is 2S + O; peak during upload/cleanup is at least 3S + O. Storage download egress is (W + R)S. Upload traffic WS leaves Render. RPC responses, HTTP headers, TLS, retries and other API/media traffic are additional. Public ephemeral inspector polls do not create new snapshots when the database has not changed; rate-limit writes, sessions, background jobs and housekeeping can do so. `checkpoint.published` logs include real bytes and revision to measure actual frequency once hosted.

At the measured final size, 100 publications/day for 30 days plus 60 restores would download about 0.903 GB and upload about 0.885 GB, before overhead. This assumes an unchanged small database; it is not a forecast as records accumulate. At the 32 MiB bound plus 32 encryption bytes, the same workload downloads about 102.68 GB. A 5 GB download allowance covers only about 149 such full-size checkpoint downloads (publications plus restores), before all other egress. The 32 MiB application limit is not a free-tier usage guarantee. Whole snapshots are unsuitable for sustained growth/high write rates.

## Official limits checked on 2026-10-25

Supabase lists 500 MB database space, 1 GB file storage and separate 5 GB uncached/cached egress allowances on Free; projects can pause after a week of inactivity. Our Postgres data is only pointer metadata; SQLite snapshots consume file storage. See [Supabase pricing](https://supabase.com/pricing). Downloads from Storage contribute to egress; do not assume private read-backs use a CDN cache allowance. See [egress accounting](https://supabase.com/docs/guides/platform/manage-your-usage/egress). Free uploads cannot exceed 50 MB, so the bounded snapshot fits the per-file limit, subject to bucket settings ([file limits](https://supabase.com/docs/guides/storage/uploads/file-limits)).

Render lists 0.1 CPU and 512 MB RAM for its Free web-service plan ([official compute-plan reference](https://render.com/docs/blueprint-spec#plan)). It documents 750 free instance hours per workspace/month, sleep after 15 idle minutes, ephemeral files, and bandwidth/build-minute limits. Excess usage can cause charges or suspension depending on payment/spend settings. High service-initiated traffic to external databases/object storage may also cause suspension. Account-specific included bandwidth/build amounts must be checked in the actual dashboard; no account exists to verify those balances. See [Render free limitations](https://render.com/docs/free). Keep paid upgrades disabled and inspect billing settings before deployment. No paid plan was purchased or enabled.

The preview file is 1,489,227 bytes and the full recording 9,902,001 bytes. At 1,000 fresh complete downloads, that is about 1.49 GB and 9.90 GB respectively, before other assets/API responses or provider overhead. Looping a buffered preview does not imply downloading the file again on every loop; actual range requests/cache misses must be measured. Vercel serves the bundled video and frontend. Its Hobby documentation lists 100 GB fast data transfer, 10 GB origin transfer and 1 million CDN requests; excess usage can disable a feature until its limit resets ([Hobby limits](https://vercel.com/docs/plans/hobby)). Its traffic is not included in checkpoint arithmetic; measure real asset delivery and review the actual account's plan/eligibility/limits before publication. No account/project usage has been verified. These constraints prevent advertising this architecture as an assured free hosted service.
