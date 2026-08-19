-- One column on packages: an expiry date for a single block, overriding
-- whatever the business-wide duration works out to.
-- Paste into the Supabase SQL editor and run once. Safe to run again.
--
-- Most of this feature is NOT here, on purpose.
--
-- The duration lives in settings, and an expiry is worked out from the day a
-- package was sold plus that duration. Nothing is written per row, which
-- means turning the duration off -- or changing it -- puts every package back
-- to what it was. Stamping a date onto ten thousand rows at the moment
-- somebody typed "6" into a settings box would have been a one-way door, and
-- the thing being decided is when a client stops being able to use days they
-- have already paid for.
--
-- This column is the exception to that rule: a manager extending ONE block,
-- because a family was away or because it is the right thing to do. Null
-- means "use the business-wide duration". A date here wins over it, in either
-- direction -- it can shorten as well as extend, though extending is what it
-- is for.
--
-- No apostrophe, quote or dollar-quoted block appears in any comment here,
-- for the Supabase SQL editor reason noted in the other migrations.

alter table packages add column if not exists expires_on date;

-- ---------------------------------------------------------------------
-- Check. Expect one row, date, nullable.
-- ---------------------------------------------------------------------
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'packages'
  and column_name = 'expires_on';
