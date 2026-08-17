-- One column on payments: the tip taken alongside it.
-- Paste into the Supabase SQL editor and run once. Safe to run again.
--
-- A tip is NOT a payment. It is money the business collects on behalf of the
-- people who did the work, and it settles nothing the client owes.
--
-- That distinction is the whole reason this is its own column rather than
-- part of amount. Balances settle the oldest charge first, so a $10 tip
-- folded into a $50 payment would read as $60 against a $50 day: the
-- household would show $10 in credit that does not exist, and the next visit
-- would quietly draw on it. The error compounds and nothing in the app would
-- ever flag it, because the arithmetic is perfectly consistent -- it is the
-- input that is wrong.
--
-- So: amount is what clears the balance, tip rides alongside it, and every
-- balance calculation ignores tips entirely. The only places tips appear are
-- the day report -- where the front desk divides them up -- and the payment
-- row itself.
--
-- Null means nobody recorded a tip, which is not the same as a tip of zero.
-- Kept nullable for that reason: an old payment predating this column has an
-- unknown tip, not a tip of nothing.
--
-- No apostrophe, quote or dollar-quoted block appears in any comment here,
-- for the Supabase SQL editor reason noted in the other migrations.

alter table payments add column if not exists tip numeric;

-- A tip cannot be negative. Refunding one is a negative PAYMENT, not a
-- negative tip, and the two must not be confusable in a report.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'payments_tip_not_negative'
  ) then
    alter table payments add constraint payments_tip_not_negative check (tip is null or tip >= 0);
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Check. Expect one row, numeric, nullable.
-- ---------------------------------------------------------------------
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'payments'
  and column_name = 'tip';
