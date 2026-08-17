-- One column on signins: whether staff have said this visit must not spend a
-- walk from a package. Paste into the Supabase SQL editor and run once. Safe
-- to run again.
--
-- The exact counterpart of package_opt_out, which signin-notes-migration.sql
-- added for daycare days. Its comment ends with a line that reads, today, as
-- a warning that came true:
--
--   "Walk packages were never projected, which is why they always worked and
--    this did not."
--
-- Walk packages are projected now. The sign-in list used to show No walk used
-- beside an estimate reading Walk covered by package, because sign-out falls
-- back to any walk package with days left when staff have not picked one --
-- so the row said one thing and checkout did another. Showing the block that
-- is going to be spent fixed the contradiction and inherited the older bug in
-- the same motion: with nowhere to record a refusal, choosing No walk used
-- changed nothing into nothing and the projection painted the block straight
-- back. The option was there and could not be taken.
--
-- With this column the refusal is stored on the visit, survives a reload,
-- reaches checkout, and the walk bills at the ordinary add-on price.
--
-- A null means nobody has decided, which is not the same as false.
--
-- No apostrophe, quote or dollar-quoted block appears in any comment here,
-- for the Supabase SQL editor reason noted in the other migrations.

alter table signins add column if not exists walk_opt_out boolean;

-- ---------------------------------------------------------------------
-- Check. Expect one row, nullable.
-- ---------------------------------------------------------------------
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'signins'
  and column_name = 'walk_opt_out';
